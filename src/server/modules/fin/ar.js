import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { billOf } from '../bill/index.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.05: accounts receivable. A receivable is made by itself when a tax invoice is issued (22.04; the posting engine of 23.02 posts it: Dr trade receivables,
// Cr revenue and GST output) or typed for other income (scrap sale, hire-out, rent: approved by the accounts manager and posted here). A receipt records the money
// received and what the client deducted (TDS under s.393(1) / 194C, GST-TDS under s.51 of the CGST Act, retention, other), is posted when entered (Dr bank, Dr TDS
// receivable, Dr GST-TDS receivable, Dr retention receivable, Dr the other deduction's account; Cr trade receivables) and is set against invoices, oldest first or
// by hand (BR-01: what is set against invoices is at most the amount plus the deductions; the rest is on account). Credit notes (rate revision, dispute) carry their
// GST and, for an e-invoicing company, the date by which their IRN is due; they are approved by the accounts manager and above ₹5 lakh the CFO. A write-off is
// approved by the accounts manager, the CFO and a director. Collections: the follow-up log of an invoice (calls, letters, promises), a broken promise escalated;
// the dunning letter; the ageing, the DSO, the client statement and the TDS deducted by clients.

export const AR_INVOICE_DOC = 'FIN_AR_INVOICE';
export const AR_CN_DOC = 'FIN_AR_CREDIT_NOTE';
export const AR_WO_DOC = 'FIN_AR_WRITEOFF';
export const INCOME_KINDS = { SCRAP: 'Scrap sale', HIRE_OUT: 'Hire of plant to others', RENT: 'Rent', OTHER: 'Other income' };
export const CN_REASONS = { RATE_REVISION: 'Rate revision', DISPUTE: 'Dispute', QUANTITY: 'Quantity correction', OTHER: 'Other' };
export const FOLLOW_ACTIONS = { CALL: 'Call', EMAIL: 'E-mail', VISIT: 'Visit', LETTER: 'Letter', REMINDER: 'Reminder', ESCALATION: 'Escalation' };
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const money = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const quarterOf = (d) => { const m = Number(d.slice(5, 7)); return m >= 4 && m <= 6 ? 'Q1' : m <= 9 && m >= 7 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4'; };
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

for (const [key, dataType, def, description] of [
  ['fin.ar.cn_cfo_limit', 'integer', 500000, 'Part 23.05 §9: a credit note above this many rupees is approved by the CFO after the accounts manager.'],
  ['fin.ar.default_credit_days', 'integer', 30, 'Part 23.05 FR-01: the days to the due date of an other-income invoice, and of a tax invoice whose contract gives no payment period.'],
  ['fin.ar.irn_window_days', 'integer', 30, 'Part 23.05 FR-04: a credit note of a company that e-invoices (aggregate turnover of ₹10 crore or more) gets its IRN within this many days of its date (the IRP\'s reporting window, to be confirmed against the GSTN advisory: D-722).'],
  ['fin.ar.dso_days', 'integer', 90, 'Part 23.05 FR-06: the days of sales the DSO is measured over.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

export const arList = defineList({
  code: 'fin.ar_invoices', label: 'Receivables', permission: 'fin.invoice.view',
  from: 'ar_invoices x JOIN mdm_partners p ON p.id = x.partner_id', where: 'x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Receivable' }, client: { sql: 'p.legal_name', type: 'text', label: 'Client' }, invoiceNo: { sql: "COALESCE(x.invoice_no, '')", type: 'text', label: 'Invoice' },
    source: { sql: 'x.inv_source', type: 'enum', label: 'From', options: [['TAX_INVOICE', 'Tax invoice (22.04)'], ['OTHER_INCOME', 'Other income']] }, invoiceDate: { sql: 'x.invoice_date', type: 'date', label: 'Date' }, dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' },
    amount: { sql: '(x.amount_paise / 100.0)', type: 'money', label: 'Amount' }, balance: { sql: '((x.amount_paise - x.received_paise - x.credited_paise - x.written_off_paise) / 100.0)', type: 'money', label: 'Balance' },
    overdue: { sql: "(CASE WHEN x.status = 'APPROVED' AND x.amount_paise - x.received_paise - x.credited_paise - x.written_off_paise > 0 AND x.due_date < date('now') THEN CAST(julianday('now') - julianday(x.due_date) AS INTEGER) ELSE 0 END)", type: 'number', label: 'Days overdue' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) },
  },
});
export const receiptList = defineList({
  code: 'fin.ar_receipts', label: 'Receipts', permission: 'fin.receipt.view',
  from: 'ar_receipts x JOIN mdm_partners p ON p.id = x.partner_id', where: 'x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Receipt' }, client: { sql: 'p.legal_name', type: 'text', label: 'Client' }, date: { sql: 'x.receipt_date', type: 'date', label: 'Date' }, reference: { sql: "COALESCE(x.reference, '')", type: 'text', label: 'UTR / cheque' },
    amount: { sql: '(x.amount_paise / 100.0)', type: 'money', label: 'Received' }, deductions: { sql: '((x.tds_paise + x.gst_tds_paise + x.retention_paise + x.other_ded_paise) / 100.0)', type: 'money', label: 'Deducted by the client' },
    unallocated: { sql: '(x.unallocated_paise / 100.0)', type: 'money', label: 'On account' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: [['DRAFT', 'Draft'], ['APPROVED', 'Posted'], ['CANCELLED', 'Cancelled']] },
  },
});

/** @param {{ db: any, base: any, gl: any, flags: any }} o */
// D-736: TCS on scrap, s.206C(1) (collection code 6CE): 1 %; 5 % without the buyer's PAN (s.206CC)
const TCS_SCRAP_BP = 100; const TCS_NO_PAN_BP = 500;
export function createArService({ db, base, gl, flags }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key, date = todayIST()) => createParameterStore(db).get(key, { companyId, date });
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2305');
  const tcsOn = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2308') && Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tcs_collections'").get());
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const partnerOf = (companyId, id) => (id ? db.prepare('SELECT * FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), companyId) : null);
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };
  const balance = (r) => r.amount_paise - r.received_paise - r.credited_paise - r.written_off_paise;
  /** The rows a person sees: the company's, within the projects their grant covers (a project manager sees the receivables of their projects). */
  const scope = (actor, key) => { need(actor, key, 'see receivables'); const f = authz.scopeFilter(actor, key, { project: 'x.org_project_id', site: 'x.site_id' }); return `x.company_id = :c AND ${f.sql}`; };
  const invRow = (actor, id, key = 'fin.invoice.view') => { const r = db.prepare('SELECT * FROM ar_invoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, key, r.org_project_id)) throw notFound('That receivable does not exist.'); return r; };
  const ownStates = (companyId) => { const s = db.prepare('SELECT gstins_json FROM core_company_settings WHERE company_id = ?').get(companyId); const a = s ? json(s.gstins_json || '[]', []).map((g) => g.stateCode ?? String(g.gstin ?? '').slice(0, 2)) : []; const b = db.prepare("SELECT COALESCE(state_code, substr(gstin, 1, 2)) AS st FROM org_branches WHERE company_id = ? AND gstin IS NOT NULL AND gstin <> '' AND deleted_at IS NULL").all(companyId).map((r) => r.st); return new Set([...a, ...b].filter(Boolean).map(String)); };
  /** Intra-state (CGST and SGST) or inter-state (IGST): the tax invoice's own supply, or the client's GSTIN state against the company's. */
  function supplyOf(r) {
    if (r.inv_source === 'TAX_INVOICE' && r.source_ref) { const ti = db.prepare('SELECT supply FROM bill_tax_invoices WHERE id = ?').get(Number(r.source_ref)); if (ti?.supply) return ti.supply; }
    const g = db.prepare("SELECT gstin FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(r.partner_id)?.gstin; const own = ownStates(r.company_id);
    if (!g || !own.size) throw unprocessable('The state of supply cannot be told: the client\'s GSTIN or the company\'s own GSTIN is missing. Add it, then try again.');
    return own.has(String(g).slice(0, 2)) ? 'intra' : 'inter';
  }
  const gstSplit = (supply, gst) => (supply === 'inter' ? { cgst: 0, sgst: 0, igst: gst } : { cgst: Math.round(gst / 2), sgst: gst - Math.round(gst / 2), igst: 0 });
  const gstLines = (companyId, s, side) => [['230001', s.cgst], ['230002', s.sgst], ['230003', s.igst]].filter(([, v]) => v > 0).map(([c, v]) => ({ accountId: acct(companyId, c), [side]: rs(v) }));
  const dims = (r) => (r.org_project_id ? { projectId: r.org_project_id } : {});
  /** The project on a line of an account that may not carry one (its dimension rule, 06.05) is left off. */
  const projectFor = (accountId, projectId) => (!projectId || db.prepare("SELECT 1 FROM fin_dimension_rules WHERE account_id = ? AND dimension = 'PROJECT' AND requirement = 'NOT_ALLOWED' AND deleted_at IS NULL").get(accountId) ? {} : { projectId });
  const interestOf = (r, asOf = todayIST()) => { const late = Math.max(0, daysBetween(r.due_date, asOf)); return r.interest_bp && late > 0 && balance(r) > 0 ? Math.round((balance(r) * r.interest_bp * late) / (10000 * 365)) : 0; };

  // ---- FR-01: receivables from tax invoices (by the event of 22.04) ----
  const consumers = {
    onTaxInvoice(e) {
      const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || !d.invoiceId) return null;
      if (db.prepare("SELECT 1 FROM ar_invoices WHERE company_id = ? AND inv_source = 'TAX_INVOICE' AND source_ref = ? AND status != 'CANCELLED'").get(c, String(d.invoiceId))) return null;
      const k = d.contractId ? db.prepare('SELECT client_partner_id, payment_terms_json FROM ctr_contracts WHERE id = ? AND company_id = ?').get(Number(d.contractId), c) : null;
      if (!k?.client_partner_id) { notify(c, 'fin.ar.alert', ['permission:fin.invoice.approve'], d.invoiceNo, 'no client', `Tax invoice ${d.invoiceNo} has no client on its contract: no receivable was made. Name the client on the contract.`, '/finance/receivables', d.invoiceId); return null; }
      const pt = json(k.payment_terms_json || '{}', {}); const days = Number(pt.paymentDays ?? param(c, 'fin.ar.default_credit_days') ?? 30);
      const interestPct = Number(pt.delayInterestPct ?? pt.interestOnDelayPct ?? 0);
      return transaction(db, () => {
        const no = docNo(c, 'ar_invoices', 'AR'); const gst = paise(d.cgst ?? 0) + paise(d.sgst ?? 0) + paise(d.igst ?? 0);
        const id = Number(db.prepare("INSERT INTO ar_invoices (company_id, doc_no, inv_source, source_ref, org_project_id, partner_id, contract_id, invoice_no, invoice_date, due_date, taxable_paise, gst_paise, amount_paise, interest_bp, status, requested_by, approved_by, approved_at, created_by, source_type, source_id) VALUES (?, ?, 'TAX_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 'system', 'system', ?, 'system', 'bill_tax_invoices', ?)")
          .run(c, no, String(d.invoiceId), d.projectId ?? null, k.client_partner_id, Number(d.contractId), d.invoiceNo, d.invoiceDate, d.dueDate ?? addDays(d.invoiceDate, days), paise(d.taxable ?? 0), gst, paise(d.total ?? 0), Math.round(interestPct * 100), nowIso(), String(d.invoiceId)).lastInsertRowid);
        try { const ti = billOf(db)?.svc?.taxInvoices; if (!ti) throw new Error("the billing module is not mounted"); ti.linkReceivable(c, { invoiceId: d.invoiceId, arRef: no }); } catch (x) { db.prepare('UPDATE ar_invoices SET remarks = ? WHERE id = ?').run(`Not linked back to the tax invoice: ${x.message}`.slice(0, 500), id); }
        audit({ user: 'system' }, 'ar_invoices', id, 'create', c, { newValues: { source: 'TAX_INVOICE', invoice: d.invoiceNo, amount: d.total } });
        publishEvent(db, { type: 'fin.ar_invoice.created', entity: 'ar_invoices', entityId: id, actorId: 'system', companyId: c, data: { invoiceId: id, docNo: no, source: 'TAX_INVOICE', partnerId: k.client_partner_id, projectId: d.projectId ?? null, amount: d.total, dueDate: d.dueDate ?? addDays(d.invoiceDate, days) } });
        return id;
      });
    },
  };

  /** Part 23.09: an asset sold (its disposal approved) becomes a draft receivable of other income to invoice: the proceeds against the sale clearing account, its GST. */
  consumers.onAssetSold = (e) => {
    const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || d.method !== 'SALE' || !d.buyerPartnerId || !(Number(d.proceeds) > 0)) return null;
    const had = db.prepare("SELECT doc_no FROM ar_invoices WHERE company_id = ? AND source_type = 'fa_disposals' AND source_id = ? AND status != 'CANCELLED'").get(c, String(d.disposalId)); if (had) return had.doc_no;
    const income = acct(c, d.clearingAccountCode ?? '160010'); if (!income) return null; const days = Number(param(c, 'fin.ar.default_credit_days') ?? 30);
    return transaction(db, () => { const no = docNo(c, 'ar_invoices', 'AR'); const taxable = paise(d.proceeds); const gst = paise(d.gst ?? 0);
      const id = Number(db.prepare("INSERT INTO ar_invoices (company_id, doc_no, inv_source, org_project_id, partner_id, income_kind, income_account_id, description, invoice_date, due_date, taxable_paise, gst_paise, amount_paise, requested_by, created_by, source_type, source_id) VALUES (?, ?, 'OTHER_INCOME', ?, ?, 'OTHER', ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'fa_disposals', ?)")
        .run(c, no, d.projectId ?? null, Number(d.buyerPartnerId), income, `Sale of fixed asset ${d.assetNo ?? ''} ${d.description ?? ''} (${d.docNo})`.slice(0, 300), d.date, addDays(d.date, days), taxable, gst, taxable + gst, d.requestedBy ?? 'system', String(d.disposalId)).lastInsertRowid);
      audit({ user: 'system' }, 'ar_invoices', id, 'create', c, { newValues: { source: 'fa_disposals', amount: rs(taxable + gst) } });
      notify(c, 'fin.ar.alert', ['permission:fin.invoice.submit'], no, 'asset sale to invoice', `The sale of ${d.assetNo ?? 'an asset'} (${d.docNo}) is a draft receivable: check it and send it for approval.`, `/finance/receivables?id=${id}`, id); return no; });
  };

  // ---- views ----
  function invView(actor, r, detail = false) {
    const p = partnerOf(r.company_id, r.partner_id); const bal = balance(r); const today = todayIST(); const late = r.status === 'APPROVED' && bal > 0 ? Math.max(0, daysBetween(r.due_date, today)) : 0;
    const c0 = r.inv_source === 'OTHER_INCOME' ? invFlow.can(actor, r) : { edit: false, delete: false, submit: false, withdraw: false, cancel: false, amend: false };
    const o = { id: r.id, docNo: r.doc_no, source: r.inv_source, sourceRef: r.source_ref, projectId: r.org_project_id, partnerId: r.partner_id, client: p?.legal_name, contractId: r.contract_id, incomeKind: r.income_kind, description: r.description, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, dueDate: r.due_date,
      taxable: rs(r.taxable_paise), gst: rs(r.gst_paise), tcs: r.inv_source === 'OTHER_INCOME' ? rs(Math.max(0, r.amount_paise - r.taxable_paise - r.gst_paise)) : 0, amount: rs(r.amount_paise), received: rs(r.received_paise), credited: rs(r.credited_paise), writtenOff: rs(r.written_off_paise), balance: rs(bal), daysOverdue: late, interestPct: r.interest_bp / 100, interest: rs(interestOf(r)), promisedDate: r.promised_date, lastFollowupAt: r.last_followup_at,
      status: r.status, statusLabel: STATUS[r.status], journalId: r.journal_id, version: r.version,
      can: { ...c0, print: may(actor, 'fin.invoice.print', r.org_project_id), followup: r.status === 'APPROVED' && bal > 0 && may(actor, 'fin.followup.create', r.org_project_id), creditNote: r.status === 'APPROVED' && bal > 0 && may(actor, 'fin.credit_note.create'), writeOff: r.status === 'APPROVED' && bal > 0 && may(actor, 'fin.writeoff.create'), receipt: r.status === 'APPROVED' && bal > 0 && may(actor, 'fin.receipt.create') } };
    if (detail) {
      Object.assign(o, r.inv_source === 'OTHER_INCOME' ? invFlow.approveInfo(actor, r) : {});
      o.allocations = db.prepare("SELECT a.*, x.doc_no, x.receipt_date, x.reference FROM ar_allocations a JOIN ar_receipts x ON x.id = a.receipt_id WHERE a.invoice_id = ? AND a.alloc_status = 'ACTIVE' ORDER BY a.id").all(r.id).map((a) => ({ id: a.id, receiptId: a.receipt_id, receiptNo: a.doc_no, date: a.receipt_date, reference: a.reference, amount: rs(a.amount_paise) }));
      o.creditNotes = db.prepare('SELECT id, doc_no, reason, total_paise, status FROM ar_credit_notes WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((n) => ({ id: n.id, docNo: n.doc_no, reason: n.reason, total: rs(n.total_paise), status: n.status }));
      o.writeOffs = db.prepare('SELECT id, doc_no, amount_paise, status, reason FROM ar_writeoffs WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((w) => ({ id: w.id, docNo: w.doc_no, amount: rs(w.amount_paise), status: w.status, reason: w.reason }));
      o.followups = db.prepare('SELECT * FROM ar_followups WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY followup_date DESC, id DESC').all(r.id).map(fView);
    }
    return o;
  }
  const fView = (f) => ({ id: f.id, date: f.followup_date, action: f.action, actionLabel: FOLLOW_ACTIONS[f.action], notes: f.notes, contact: f.contact_person, promisedDate: f.promised_date, promised: rs(f.promised_paise), nextDate: f.next_date, by: f.by_user });

  // ---- FR-01: other income (approved by the accounts manager, posted) ----
  const invFlow = createFlow({
    db, base, docType: AR_INVOICE_DOC, table: 'ar_invoices', perm: 'fin.invoice', label: 'receivable', route: '/finance/receivables?id=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: null }), ctx: (r) => ({ total: rs(r.amount_paise) }), title: (r) => `${INCOME_KINDS[r.income_kind] ?? ''} ${money(r.amount_paise)} ${r.description ?? ''}`, notifyCode: 'fin.ar.decided', numberKey: 'FIN_AR_INVOICE', prefix: 'AR',
    beforeSubmit: (_a, r) => { if (r.inv_source !== 'OTHER_INCOME') throw unprocessable('A receivable of a tax invoice was approved with the invoice.'); supplyOf(r); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM ar_invoices WHERE id = ?').get(r.id); const s = gstSplit(supplyOf(x), x.gst_paise);
      const tcs = x.amount_paise - x.taxable_paise - x.gst_paise;
      const lines = [{ accountId: acct(x.company_id, '140001'), debit: rs(x.amount_paise), partnerId: x.partner_id, ...dims(x) }, { accountId: x.income_account_id, credit: rs(x.taxable_paise), ...projectFor(x.income_account_id, x.org_project_id) }, ...gstLines(x.company_id, s, 'credit'), ...(tcs > 0 ? [{ accountId: acct(x.company_id, '230007'), credit: rs(tcs) }] : [])];
      const j = gl.postEngine(x.company_id, { voucherType: 'SJ', date: x.invoice_date, narration: `${INCOME_KINDS[x.income_kind]} ${x.doc_no}: ${x.description ?? ''}`.slice(0, 500), sourceType: 'ar_invoices', sourceId: x.id, lines, user: actor.user });
      db.prepare('UPDATE ar_invoices SET journal_id = ? WHERE id = ?').run(j.journal.id, x.id);
      if (tcs > 0) { const p = partnerOf(x.company_id, x.partner_id); db.prepare("INSERT INTO tcs_collections (company_id, invoice_id, partner_id, nature, section, collected_on, base_paise, rate_bp, tcs_paise, pan, journal_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, 'SCRAP', '6CE', ?, ?, ?, ?, ?, ?, ?, ?, 'ar_invoices', ?)").run(x.company_id, x.id, x.partner_id, x.invoice_date, x.taxable_paise + x.gst_paise, p?.pan ? TCS_SCRAP_BP : TCS_NO_PAN_BP, tcs, p?.pan ?? null, j.journal.id, x.org_project_id ?? null, actor.user, String(x.id)); }
      publishEvent(db, { type: 'fin.ar_invoice.created', entity: 'ar_invoices', entityId: x.id, actorId: actor.user, companyId: x.company_id, data: { invoiceId: x.id, docNo: x.doc_no, source: 'OTHER_INCOME', partnerId: x.partner_id, projectId: x.org_project_id, amount: rs(x.amount_paise), dueDate: x.due_date } });
    },
  });
  function otherValues(actor, b) {
    const problems = []; const p = partnerOf(actor.companyId, b.partnerId);
    if (!p || !db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND deleted_at IS NULL").get(p.id)) problems.push({ field: 'partnerId', message: 'Choose the party.' });
    const ia = b.incomeAccountId ? db.prepare("SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND account_status = 'ACTIVE' AND is_control = 0").get(Number(b.incomeAccountId), actor.companyId) : null;
    const grp = ia ? db.prepare('SELECT code FROM fin_account_groups WHERE id = ?').get(ia.group_id)?.code ?? '' : '';
    if (!ia || !grp.startsWith('4')) problems.push({ field: 'incomeAccountId', message: 'Choose an income account (revenue or other income).' });
    if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(b.projectId), actor.companyId)) problems.push({ field: 'projectId', message: 'The project does not exist.' });
    const due = b.dueDate ?? addDays(b.invoiceDate, Number(param(actor.companyId, 'fin.ar.default_credit_days') ?? 30));
    if (due < b.invoiceDate) problems.push({ field: 'dueDate', message: 'The due date is on or after the invoice date.' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    // the receivable and the income line must satisfy their accounts' dimension rules (06.05) at save, not only when the approver posts them
    const pj = b.projectId ? Number(b.projectId) : null;
    const chk = gl.checkLines(actor.companyId, [{ accountId: acct(actor.companyId, '140001'), debit: '1', partnerId: p.id, ...(pj ? { projectId: pj } : {}) }, { accountId: ia.id, credit: '1', ...projectFor(ia.id, pj) }], { source: 'ENGINE' });
    if (chk.problems.length) throw badRequest('Correct the highlighted fields', chk.problems.map((x) => ({ field: /projectId/.test(x.field) ? 'projectId' : x.field.startsWith('lines.1') ? 'incomeAccountId' : 'partnerId', message: x.message })));
    const taxable = paise(b.amount); const gst = paise(b.gst ?? 0);
    if (b.total != null && paise(b.total) !== taxable + gst) throw badRequest('Correct the highlighted fields', [{ field: 'total', message: 'The total sent does not match the amount and the GST.' }]);
    // D-736: TCS on the sale of scrap — 1 % of the consideration (with GST), 5 % when the buyer has no PAN (s.206CC) — added to what the buyer owes
    const tcs = b.incomeKind === 'SCRAP' && tcsOn(actor.companyId) ? Math.round(((taxable + gst) * (p.pan ? TCS_SCRAP_BP : TCS_NO_PAN_BP)) / 10000) : 0;
    return { p, due, taxable, gst, tcs };
  }
  const invoices = {
    flow: invFlow,
    list(actor, query) { return runList(db, arList, parseListRequest(arList, query), { select: 'x.*', scopeSql: scope(actor, 'fin.invoice.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => invView(actor, r) }); },
    get(actor, id) { return invView(actor, invRow(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.invoice.create', 'make receivables'); const v = otherValues(actor, b);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO ar_invoices (company_id, doc_no, inv_source, org_project_id, partner_id, income_kind, income_account_id, description, invoice_no, invoice_date, due_date, taxable_paise, gst_paise, amount_paise, requested_by, created_by, source_type) VALUES (?, ?, 'OTHER_INCOME', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ar_invoices')")
          .run(actor.companyId, docNo(actor.companyId, 'ar_invoices', 'AR'), b.projectId ?? null, v.p.id, b.incomeKind, Number(b.incomeAccountId), b.description, b.invoiceNo ?? null, b.invoiceDate, v.due, v.taxable, v.gst, v.taxable + v.gst + v.tcs, actor.user, actor.user).lastInsertRowid);
        audit(actor, 'ar_invoices', id, 'create', actor.companyId, { newValues: { kind: b.incomeKind, amount: rs(v.taxable + v.gst + v.tcs), ...(v.tcs ? { tcs: rs(v.tcs) } : {}) } }); return invoices.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = invFlow.row(actor, id, 'fin.invoice.edit'); need(actor, 'fin.invoice.edit', 'change receivables'); if (r.inv_source !== 'OTHER_INCOME') throw unprocessable('A receivable of a tax invoice follows its invoice.'); if (!invFlow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned receivable is changed.'); if (b.version !== r.version) throw conflict('The receivable was changed by someone else; reload it.');
      const v = otherValues(actor, b);
      db.prepare('UPDATE ar_invoices SET org_project_id = ?, partner_id = ?, income_kind = ?, income_account_id = ?, description = ?, invoice_no = ?, invoice_date = ?, due_date = ?, taxable_paise = ?, gst_paise = ?, amount_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.projectId ?? null, v.p.id, b.incomeKind, Number(b.incomeAccountId), b.description, b.invoiceNo ?? null, b.invoiceDate, v.due, v.taxable, v.gst, v.taxable + v.gst + v.tcs, actor.user, nowIso(), r.id);
      audit(actor, 'ar_invoices', r.id, 'update', actor.companyId, { oldValues: { amount: rs(r.amount_paise) }, newValues: { amount: rs(v.taxable + v.gst + v.tcs) } }); return invoices.get(actor, r.id);
    },
    remove(actor, id) { return invFlow.remove(actor, id); },
    submit(actor, id) { invFlow.submit(actor, id); return invoices.get(actor, id); },
    withdraw(actor, id, b) { invFlow.withdraw(actor, id, b); return invoices.get(actor, id); },
    cancel(actor, id, b) { invFlow.cancel(actor, id, b); return invoices.get(actor, id); },
    history(actor, id) { return invFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return invFlow.decide(instance, actor, outcome, comment); },
    /** The open receivables of a client, oldest first (the receipt's allocation). */
    open(actor, { partnerId }) { need(actor, 'fin.receipt.create', 'enter receipts'); return db.prepare("SELECT * FROM ar_invoices WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND amount_paise - received_paise - credited_paise - written_off_paise > 0 ORDER BY due_date, id").all(actor.companyId, Number(partnerId)).map((r) => invView(actor, r)); },
    exportCsv(actor, query = {}) { need(actor, 'fin.invoice.export', 'export receivables'); const l = invoices.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'ar_invoices', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `receivables-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Receivable', 'Client', 'Invoice', 'Date', 'Due', 'Amount', 'Received', 'Credited', 'Written off', 'Balance', 'Days overdue', 'Status'], l.data.map((x) => [x.docNo, x.client, x.invoiceNo ?? '', x.invoiceDate, x.dueDate, x.amount, x.received, x.credited, x.writtenOff, x.balance, x.daysOverdue, x.statusLabel]))}`, 'utf8') }; },
    print(actor, id) { const r = invRow(actor, id, 'fin.invoice.print'); const v = invView(actor, r, true); audit(actor, 'ar_invoices', r.id, 'print', actor.companyId); const rows = [['Client', v.client], ['Invoice', `${v.invoiceNo ?? v.docNo} of ${v.invoiceDate}`], ['Due', v.dueDate], ['Amount', money(paise(v.amount))], ['Received (with deductions)', money(paise(v.received))], ['Credit notes', money(paise(v.credited))], ['Written off', money(paise(v.writtenOff))], ['Balance', money(paise(v.balance))], ...(v.interest ? [['Interest on delay', `${money(paise(v.interest))} at ${v.interestPct}% a year`]] : [])].map(([k, x]) => ({ k, v: String(x ?? '') })); return { buffer: toPdf({ columns: [{ key: 'k', label: 'Item', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows, footer: [`${v.docNo} · ${v.statusLabel}`], title: `Receivable ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf` }; },
    /** FR-05: the dunning letter of an overdue invoice. */
    dunning(actor, id) {
      const r = invRow(actor, id, 'fin.invoice.print'); const v = invView(actor, r); if (v.balance <= 0) throw unprocessable('Nothing is due on this invoice.');
      const level = db.prepare("SELECT COUNT(*) AS n FROM ar_followups WHERE invoice_id = ? AND action IN ('LETTER', 'REMINDER')").get(r.id).n + 1;
      transaction(db, () => { db.prepare("INSERT INTO ar_followups (company_id, invoice_id, partner_id, org_project_id, followup_date, action, notes, by_user, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'LETTER', ?, ?, ?, 'ar_invoices')").run(r.company_id, r.id, r.partner_id, r.org_project_id, todayIST(), `Dunning letter ${level} printed`, actor.user, actor.user); db.prepare('UPDATE ar_invoices SET last_followup_at = ? WHERE id = ?').run(nowIso(), r.id); audit(actor, 'ar_invoices', r.id, 'dunning', r.company_id, { reason: `letter ${level}` }); });
      const rows = [['To', v.client], ['Our invoice', `${v.invoiceNo ?? v.docNo} of ${v.invoiceDate}`], ['Due on', v.dueDate], ['Days overdue', String(v.daysOverdue)], ['Amount of the invoice', money(paise(v.amount))], ['Received and set against it', money(paise(v.received + v.credited))], ['Balance due', money(paise(v.balance))], ...(v.interest ? [['Interest on the delay under the contract', money(paise(v.interest))]] : []), ['', level === 1 ? 'We request payment of the balance at the earliest.' : level === 2 ? 'This is our second reminder. Please pay the balance within seven days.' : 'Final reminder: unless the balance is paid within seven days we shall take the steps the contract allows.']].map(([k, x]) => ({ k, v: x }));
      return { buffer: toPdf({ columns: [{ key: 'k', label: '', type: 'text' }, { key: 'v', label: '', type: 'text' }], rows, footer: [`Reminder ${level} · ${todayIST()}`], title: `Payment reminder — ${v.client}` }), contentType: 'application/pdf', fileName: `reminder-${level}-${v.docNo.replaceAll('/', '-')}.pdf` };
    },
  };

  // ---- FR-02, BR-01: receipts and their allocation ----
  const recRow = (actor, id) => { const r = db.prepare('SELECT * FROM ar_receipts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'fin.receipt.view', r.org_project_id)) throw notFound('That receipt does not exist.'); return r; };
  const gross = (r) => r.amount_paise + r.tds_paise + r.gst_tds_paise + r.retention_paise + r.other_ded_paise;
  function recView(actor, r, detail = false) {
    const p = partnerOf(r.company_id, r.partner_id); const b = db.prepare('SELECT name, account_last4 FROM fin_bank_accounts WHERE id = ?').get(r.bank_account_id);
    const o = { id: r.id, docNo: r.doc_no, partnerId: r.partner_id, client: p?.legal_name, date: r.receipt_date, bankAccountId: r.bank_account_id, bank: b ? `${b.name} ••••${b.account_last4}` : null, reference: r.reference, projectId: r.org_project_id,
      amount: rs(r.amount_paise), tds: rs(r.tds_paise), tdsSection: r.tds_section, tdsQuarter: r.tds_quarter, tdsMatched: Boolean(r.tds_matched_26as), gstTds: rs(r.gst_tds_paise), retention: rs(r.retention_paise), otherDeductions: rs(r.other_ded_paise), others: json(r.other_ded_json, []).map((x) => ({ ...x, amount: rs(x.amountPaise) })), gross: rs(gross(r)), allocated: rs(r.allocated_paise), unallocated: rs(r.unallocated_paise),
      status: r.status, statusLabel: r.status === 'APPROVED' ? 'Posted' : r.status === 'DRAFT' ? 'Draft' : STATUS[r.status], journalId: r.journal_id, version: r.version, cancelReason: r.cancel_reason,
      can: { edit: r.status === 'DRAFT' && may(actor, 'fin.receipt.edit'), delete: r.status === 'DRAFT' && may(actor, 'fin.receipt.delete'), post: r.status === 'DRAFT' && may(actor, 'fin.receipt.submit'), allocate: r.status === 'APPROVED' && r.unallocated_paise > 0 && may(actor, 'fin.receipt.edit'), cancel: r.status === 'APPROVED' && may(actor, 'fin.receipt.cancel'), tdsMatch: r.status === 'APPROVED' && r.tds_paise > 0 && may(actor, 'fin.receipt.approve'), print: may(actor, 'fin.receipt.print') } };
    if (detail) o.allocations = db.prepare("SELECT a.*, i.doc_no, i.invoice_no FROM ar_allocations a JOIN ar_invoices i ON i.id = a.invoice_id WHERE a.receipt_id = ? AND a.alloc_status = 'ACTIVE' ORDER BY a.id").all(r.id).map((a) => ({ id: a.id, invoiceId: a.invoice_id, docNo: a.doc_no, invoiceNo: a.invoice_no, amount: rs(a.amount_paise), on: a.allocated_on }));
    return o;
  }
  /** BR-01: the allocation of a receipt: by hand, or oldest first; at most what each invoice has open and, in all, what the receipt brings (the amount and the deductions). */
  function planAllocation(companyId, partnerId, available, list, auto) {
    const open = db.prepare("SELECT * FROM ar_invoices WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND amount_paise - received_paise - credited_paise - written_off_paise > 0 ORDER BY due_date, id").all(companyId, partnerId);
    const problems = []; let plan = [];
    if (auto) { let left = available; for (const r of open) { if (left <= 0) break; const a = Math.min(left, balance(r)); plan.push({ invoice: r, amount: a }); left -= a; } }
    else {
      plan = (list ?? []).map((l, i) => { const r = open.find((x) => x.id === Number(l.invoiceId)); const a = paise(l.amount); if (!r) problems.push({ field: `allocations.${i}.invoiceId`, message: 'Choose an open invoice of this client.' }); else if (!(a > 0) || a > balance(r)) problems.push({ field: `allocations.${i}.amount`, message: `${r.doc_no} has ${money(balance(r))} open.` }); return { invoice: r, amount: a }; });
      const seen = new Set(); plan.forEach((x, i) => { if (x.invoice && seen.has(x.invoice.id)) problems.push({ field: `allocations.${i}.invoiceId`, message: 'This invoice is already in the allocation.' }); if (x.invoice) seen.add(x.invoice.id); });
      const total = plan.reduce((s, x) => s + (x.amount || 0), 0);
      if (total > available) problems.push({ field: 'allocations', message: `The allocation (${money(total)}) is more than the receipt brings (${money(available)}: the amount and the deductions).` });
    }
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    return plan.filter((x) => x.invoice && x.amount > 0);
  }
  function recValues(actor, b) {
    const problems = []; const p = partnerOf(actor.companyId, b.partnerId);
    if (!p || !db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role = 'CLIENT' AND deleted_at IS NULL").get(p.id)) problems.push({ field: 'partnerId', message: 'Choose the client.' });
    const bank = db.prepare("SELECT * FROM fin_bank_accounts WHERE id = ? AND company_id = ? AND acct_status = 'ACTIVE' AND deleted_at IS NULL").get(Number(b.bankAccountId), actor.companyId);
    if (!bank) problems.push({ field: 'bankAccountId', message: 'Choose the company\'s bank account the money came into.' });
    if (b.receiptDate > todayIST()) problems.push({ field: 'receiptDate', message: 'A receipt is dated today or before.' });
    const others = (b.otherDeductions ?? []).map((o, i) => { const ac = db.prepare("SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND account_status = 'ACTIVE' AND is_control = 0").get(Number(o.accountId), actor.companyId); if (!ac) problems.push({ field: `otherDeductions.${i}.accountId`, message: 'Choose the account the deduction goes to (not a control account).' }); return { label: o.label, accountId: Number(o.accountId), amountPaise: paise(o.amount) }; });
    if (b.tds && !b.tdsSection) problems.push({ field: 'tdsSection', message: 'Give the section the client deducted TDS under (e.g. 393(1) or 194C).' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    return { p, bank, others, amount: paise(b.amount), tds: paise(b.tds ?? 0), gstTds: paise(b.gstTds ?? 0), retention: paise(b.retention ?? 0), other: others.reduce((s, o) => s + o.amountPaise, 0) };
  }
  /** The receipt's journal: Dr bank and the client's deductions, Cr trade receivables split by the projects of the invoices it settles (the account needs its project); what stays on account goes to the receipt's project. */
  function postReceipt(actor, r, plan) {
    const c = r.company_id; const others = json(r.other_ded_json, []);
    const projects = [...new Set(plan.map((x) => x.invoice.org_project_id ?? null))];
    const home = r.org_project_id ?? (projects.length === 1 ? projects[0] : null);
    const settled = plan.reduce((s2, x) => s2 + x.amount, 0); const left = gross(r) - settled;
    const needHome = left > 0 || r.retention_paise > 0 || others.length > 0;
    if (needHome && !home) throw badRequest('Correct the highlighted fields', [{ field: 'projectId', message: 'Give the project the retention, the other deductions and the amount on account belong to (the receipt settles invoices of several projects, or none).' }]);
    const proj = home ? { projectId: home } : {};
    const byProject = new Map(); for (const x of plan) { const k = x.invoice.org_project_id ?? home; byProject.set(k, (byProject.get(k) ?? 0) + x.amount); }
    if (left > 0) byProject.set(home, (byProject.get(home) ?? 0) + left);
    const bank = db.prepare('SELECT gl_account_id FROM fin_bank_accounts WHERE id = ?').get(r.bank_account_id);
    const lines = [{ accountId: bank.gl_account_id, debit: rs(r.amount_paise) },
      ...(r.tds_paise ? [{ accountId: acct(c, '170004'), debit: rs(r.tds_paise), partnerId: r.partner_id }] : []),
      ...(r.gst_tds_paise ? [{ accountId: acct(c, '170005'), debit: rs(r.gst_tds_paise), partnerId: r.partner_id }] : []),
      ...(r.retention_paise ? [{ accountId: acct(c, '140002'), debit: rs(r.retention_paise), partnerId: r.partner_id, ...proj }] : []),
      ...others.map((o) => ({ accountId: o.accountId, debit: rs(o.amountPaise), ...proj })),
      ...[...byProject.entries()].map(([pj, amt]) => ({ accountId: acct(c, '140001'), credit: rs(amt), partnerId: r.partner_id, ...(pj ? { projectId: pj } : {}) }))];
    if (!r.org_project_id && home) db.prepare('UPDATE ar_receipts SET org_project_id = ? WHERE id = ?').run(home, r.id);
    return gl.postEngine(c, { voucherType: 'RV', date: r.receipt_date, narration: `Receipt ${r.doc_no} from ${partnerOf(c, r.partner_id)?.legal_name ?? ''}${r.reference ? ` (${r.reference})` : ''}`.slice(0, 500), sourceType: 'ar_receipts', sourceId: r.id, lines, user: actor.user }).journal.id;
  }
  function applyAllocation(actor, r, plan) {
    const ins = db.prepare("INSERT INTO ar_allocations (company_id, receipt_id, invoice_id, amount_paise, allocated_on, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'ar_receipts', ?)");
    for (const x of plan) { ins.run(r.company_id, r.id, x.invoice.id, x.amount, todayIST(), x.invoice.org_project_id ?? null, actor.user, String(r.id)); db.prepare('UPDATE ar_invoices SET received_paise = received_paise + ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(x.amount, actor.user, nowIso(), x.invoice.id); }
    const done = plan.reduce((s, x) => s + x.amount, 0);
    db.prepare('UPDATE ar_receipts SET allocated_paise = allocated_paise + ?, unallocated_paise = unallocated_paise - ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(done, done, actor.user, nowIso(), r.id);
    return done;
  }
  const receipts = {
    list(actor, query) { return runList(db, receiptList, parseListRequest(receiptList, query), { select: 'x.*', scopeSql: scope(actor, 'fin.receipt.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => recView(actor, r) }); },
    get(actor, id) { return recView(actor, recRow(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.receipt.create', 'enter receipts'); const v = recValues(actor, b);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO ar_receipts (company_id, doc_no, partner_id, receipt_date, bank_account_id, reference, amount_paise, tds_paise, gst_tds_paise, retention_paise, other_ded_paise, other_ded_json, unallocated_paise, tds_section, tds_quarter, org_project_id, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ar_receipts')")
          .run(actor.companyId, docNo(actor.companyId, 'ar_receipts', 'RCPT'), v.p.id, b.receiptDate, v.bank.id, b.reference ?? null, v.amount, v.tds, v.gstTds, v.retention, v.other, JSON.stringify(v.others), v.amount + v.tds + v.gstTds + v.retention + v.other, b.tdsSection ?? null, v.tds ? quarterOf(b.receiptDate) : null, b.projectId ?? null, actor.user, actor.user).lastInsertRowid);
        db.prepare('UPDATE ar_receipts SET remarks = ? WHERE id = ?').run(JSON.stringify({ auto: Boolean(b.auto), allocations: b.allocations ?? [] }), id);
        audit(actor, 'ar_receipts', id, 'create', actor.companyId, { newValues: { amount: rs(v.amount), deductions: rs(v.tds + v.gstTds + v.retention + v.other) } });
        if (b.post) receipts.post(actor, id);
        return receipts.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = recRow(actor, id); need(actor, 'fin.receipt.edit', 'change receipts'); if (r.status !== 'DRAFT') throw conflict('Only a draft receipt is changed; a posted one is cancelled.'); if (b.version !== r.version) throw conflict('The receipt was changed by someone else; reload it.');
      const v = recValues(actor, b);
      db.prepare('UPDATE ar_receipts SET partner_id = ?, receipt_date = ?, bank_account_id = ?, reference = ?, amount_paise = ?, tds_paise = ?, gst_tds_paise = ?, retention_paise = ?, other_ded_paise = ?, other_ded_json = ?, unallocated_paise = ?, tds_section = ?, tds_quarter = ?, org_project_id = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(v.p.id, b.receiptDate, v.bank.id, b.reference ?? null, v.amount, v.tds, v.gstTds, v.retention, v.other, JSON.stringify(v.others), v.amount + v.tds + v.gstTds + v.retention + v.other, b.tdsSection ?? null, v.tds ? quarterOf(b.receiptDate) : null, b.projectId ?? null, JSON.stringify({ auto: Boolean(b.auto), allocations: b.allocations ?? [] }), actor.user, nowIso(), r.id);
      audit(actor, 'ar_receipts', r.id, 'update', actor.companyId); return receipts.get(actor, r.id);
    },
    remove(actor, id) { const r = recRow(actor, id); need(actor, 'fin.receipt.delete', 'delete receipts'); if (r.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE ar_receipts SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'ar_receipts', r.id, 'delete', actor.companyId); return { id: r.id, deleted: true }; },
    /** Post a receipt: the journal, the allocation it was saved with (or oldest first), `fin.receipt.posted`. The money is already in the bank: no approval (ADR-650). */
    post(actor, id) {
      const r = recRow(actor, id); need(actor, 'fin.receipt.submit', 'post receipts'); if (r.status !== 'DRAFT') throw conflict('The receipt is posted already.');
      const want = json(r.remarks || '{}', {}); const plan = planAllocation(r.company_id, r.partner_id, gross(r), want.allocations, want.auto || !(want.allocations ?? []).length);
      return transaction(db, () => {
        const jid = postReceipt(actor, r, plan);
        db.prepare("UPDATE ar_receipts SET status = 'APPROVED', journal_id = ?, approved_by = ?, approved_at = ?, remarks = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(jid, actor.user, nowIso(), actor.user, nowIso(), r.id);
        const done = applyAllocation(actor, { ...r, status: 'APPROVED' }, plan);
        audit(actor, 'ar_receipts', r.id, 'post', r.company_id, { newValues: { journal: jid, allocated: rs(done), onAccount: rs(gross(r) - done) } });
        publishEvent(db, { type: 'fin.receipt.posted', entity: 'ar_receipts', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { receiptId: r.id, docNo: r.doc_no, partnerId: r.partner_id, date: r.receipt_date, bankAccountId: r.bank_account_id, reference: r.reference, amount: rs(r.amount_paise), tds: rs(r.tds_paise), gstTds: rs(r.gst_tds_paise), retention: rs(r.retention_paise), other: rs(r.other_ded_paise), allocated: rs(done), onAccount: rs(gross(r) - done), journalId: jid, invoices: plan.map((x) => ({ invoiceId: x.invoice.id, amount: rs(x.amount) })) } });
        return receipts.get(actor, r.id);
      });
    },
    /** What was left on account set against invoices later. */
    allocate(actor, id, { allocations, auto }) {
      const r = recRow(actor, id); need(actor, 'fin.receipt.edit', 'allocate receipts'); if (r.status !== 'APPROVED') throw conflict('Only a posted receipt is allocated.'); if (r.unallocated_paise <= 0) throw conflict('Nothing of this receipt is on account.');
      const plan = planAllocation(r.company_id, r.partner_id, r.unallocated_paise, allocations, auto);
      if (!plan.length) throw unprocessable('There is nothing open of this client to set the receipt against.');
      return transaction(db, () => { const done = applyAllocation(actor, r, plan); audit(actor, 'ar_receipts', r.id, 'allocate', r.company_id, { newValues: { allocated: rs(done) } }); publishEvent(db, { type: 'fin.receipt.allocated', entity: 'ar_receipts', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { receiptId: r.id, docNo: r.doc_no, partnerId: r.partner_id, invoices: plan.map((x) => ({ invoiceId: x.invoice.id, amount: rs(x.amount) })) } }); return receipts.get(actor, r.id); });
    },
    /** A posted receipt cancelled (a cheque bounced, entered twice): the journal reversed, its allocations undone. */
    cancel(actor, id, { reason }) {
      const r = recRow(actor, id); need(actor, 'fin.receipt.cancel', 'cancel receipts'); if (r.status === 'CANCELLED') throw conflict('The receipt is cancelled already.');
      return transaction(db, () => {
        if (r.status === 'APPROVED') {
          gl.reverseEngine(r.company_id, r.journal_id, { date: todayIST(), reason: `Receipt cancelled: ${reason}`.slice(0, 200), user: actor.user });
          for (const a of db.prepare("SELECT * FROM ar_allocations WHERE receipt_id = ? AND alloc_status = 'ACTIVE'").all(r.id)) { db.prepare("UPDATE ar_allocations SET alloc_status = 'REVERSED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, nowIso(), a.id); db.prepare('UPDATE ar_invoices SET received_paise = MAX(0, received_paise - ?), version = version + 1 WHERE id = ?').run(a.amount_paise, a.invoice_id); }
          publishEvent(db, { type: 'fin.receipt.cancelled', entity: 'ar_receipts', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { receiptId: r.id, docNo: r.doc_no, partnerId: r.partner_id, amount: rs(r.amount_paise), reason } });
        }
        db.prepare("UPDATE ar_receipts SET status = 'CANCELLED', cancel_reason = ?, allocated_paise = 0, unallocated_paise = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id);
        audit(actor, 'ar_receipts', r.id, 'cancel', r.company_id, { reason }); return receipts.get(actor, r.id);
      });
    },
    /** FR-03: the TDS of a receipt marked as found in Form 26AS (the reconciliation itself is 23.08). */
    tdsMatched(actor, id, { matched }) { const r = recRow(actor, id); need(actor, 'fin.receipt.approve', 'mark TDS as matched'); if (r.status !== 'APPROVED' || !r.tds_paise) throw unprocessable('Only a posted receipt with TDS is matched.'); db.prepare('UPDATE ar_receipts SET tds_matched_26as = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(matched ? 1 : 0, actor.user, nowIso(), r.id); audit(actor, 'ar_receipts', r.id, matched ? 'tds_matched' : 'tds_unmatched', r.company_id); return receipts.get(actor, r.id); },
    exportCsv(actor, query = {}) { need(actor, 'fin.receipt.export', 'export receipts'); const l = receipts.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'ar_receipts', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `receipts-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Receipt', 'Client', 'Date', 'UTR / cheque', 'Received', 'TDS', 'GST-TDS', 'Retention', 'Other', 'On account', 'Status'], l.data.map((x) => [x.docNo, x.client, x.date, x.reference ?? '', x.amount, x.tds, x.gstTds, x.retention, x.otherDeductions, x.unallocated, x.statusLabel]))}`, 'utf8') }; },
  };

  // ---- FR-04: credit notes (accounts manager; CFO above ₹5 lakh) ----
  const cnFlow = createFlow({
    db, base, docType: AR_CN_DOC, table: 'ar_credit_notes', perm: 'fin.credit_note', label: 'credit note', route: '/finance/receivables?cn=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: null }), ctx: (r) => ({ total: rs(r.total_paise), overCfo: r.total_paise > Number(param(r.company_id, 'fin.ar.cn_cfo_limit') ?? 500000) * 100 ? 1 : 0 }), title: (r) => `${CN_REASONS[r.reason]} ${money(r.total_paise)}`, notifyCode: 'fin.ar.decided', numberKey: 'FIN_AR_CN', prefix: 'CN',
    beforeSubmit: (_a, r) => { const inv = db.prepare('SELECT * FROM ar_invoices WHERE id = ?').get(r.invoice_id); if (r.total_paise > balance(inv)) throw unprocessable(`The credit note (${money(r.total_paise)}) is more than the invoice has open (${money(balance(inv))}).`); },
    onApproved: (actor, r) => {
      const n = db.prepare('SELECT * FROM ar_credit_notes WHERE id = ?').get(r.id); const inv = db.prepare('SELECT * FROM ar_invoices WHERE id = ?').get(n.invoice_id);
      const revenue = inv.income_account_id ?? acct(n.company_id, '410001'); const d = n.org_project_id ? { projectId: n.org_project_id } : {};
      const lines = [{ accountId: revenue, debit: rs(n.taxable_paise), ...projectFor(revenue, n.org_project_id) }, ...gstLines(n.company_id, { cgst: n.cgst_paise, sgst: n.sgst_paise, igst: n.igst_paise }, 'debit'), { accountId: acct(n.company_id, '140001'), credit: rs(n.total_paise), partnerId: n.partner_id, ...d }];
      const j = gl.postEngine(n.company_id, { voucherType: 'CN', date: n.note_date, narration: `Credit note ${n.doc_no} to ${partnerOf(n.company_id, n.partner_id)?.legal_name ?? ''}: ${CN_REASONS[n.reason]} ${n.description}`.slice(0, 500), sourceType: 'ar_credit_notes', sourceId: n.id, lines, user: actor.user });
      db.prepare('UPDATE ar_credit_notes SET journal_id = ? WHERE id = ?').run(j.journal.id, n.id);
      db.prepare('UPDATE ar_invoices SET credited_paise = credited_paise + ?, version = version + 1 WHERE id = ?').run(n.total_paise, inv.id);
      publishEvent(db, { type: 'fin.ar_credit_note.approved', entity: 'ar_credit_notes', entityId: n.id, actorId: actor.user, companyId: n.company_id, data: { noteId: n.id, docNo: n.doc_no, invoiceId: inv.id, invoiceNo: inv.invoice_no, partnerId: n.partner_id, reason: n.reason, taxable: rs(n.taxable_paise), cgst: rs(n.cgst_paise), sgst: rs(n.sgst_paise), igst: rs(n.igst_paise), total: rs(n.total_paise), irnRequired: Boolean(n.irn_required), irnDueDate: n.irn_due_date } });
      if (n.irn_required) notify(n.company_id, 'fin.ar.alert', ['permission:fin.credit_note.approve'], n.doc_no, 'IRN due', `Credit note ${n.doc_no} needs its IRN by ${n.irn_due_date} (e-invoicing).`, `/finance/receivables?cn=${n.id}`, n.id);
    },
  });
  const cnView = (actor, n, detail = false) => { const inv = db.prepare('SELECT doc_no, invoice_no FROM ar_invoices WHERE id = ?').get(n.invoice_id); return { id: n.id, docNo: n.doc_no, invoiceId: n.invoice_id, invoiceDoc: inv?.doc_no, invoiceNo: inv?.invoice_no, client: partnerOf(n.company_id, n.partner_id)?.legal_name, reason: n.reason, reasonLabel: CN_REASONS[n.reason], date: n.note_date, description: n.description, taxable: rs(n.taxable_paise), cgst: rs(n.cgst_paise), sgst: rs(n.sgst_paise), igst: rs(n.igst_paise), total: rs(n.total_paise), irnRequired: Boolean(n.irn_required), irnDueDate: n.irn_due_date, irn: n.irn, journalId: n.journal_id, status: n.status, statusLabel: STATUS[n.status], version: n.version, can: cnFlow.can(actor, n), ...(detail ? cnFlow.approveInfo(actor, n) : {}) }; };
  function cnValues(actor, b) {
    const inv = invRow(actor, b.invoiceId); if (inv.status !== 'APPROVED') throw badRequest('Correct the highlighted fields', [{ field: 'invoiceId', message: 'Choose an approved receivable.' }]);
    const taxable = paise(b.taxable); const rate = inv.taxable_paise > 0 ? inv.gst_paise / inv.taxable_paise : 0; const gst = b.gst != null ? paise(b.gst) : Math.round(taxable * rate); const s = gstSplit(supplyOf(inv), gst);
    if (taxable + gst > balance(inv)) throw badRequest('Correct the highlighted fields', [{ field: 'taxable', message: `With its GST the credit note is ${money(taxable + gst)}; the invoice has ${money(balance(inv))} open.` }]);
    const einv = param(actor.companyId, 'bill.invoice.einvoice', b.noteDate) === true;
    return { inv, taxable, s, total: taxable + gst, irn: einv ? 1 : 0, irnDue: einv ? addDays(b.noteDate, Number(param(actor.companyId, 'fin.ar.irn_window_days', b.noteDate) ?? 30)) : null };
  }
  const notes = {
    flow: cnFlow,
    list(actor) { need(actor, 'fin.credit_note.view', 'see credit notes'); return db.prepare('SELECT * FROM ar_credit_notes WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 200').all(actor.companyId).map((n) => cnView(actor, n)); },
    get(actor, id) { return cnView(actor, cnFlow.row(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.credit_note.create', 'make credit notes'); const v = cnValues(actor, b);
      return transaction(db, () => { const id = Number(db.prepare('INSERT INTO ar_credit_notes (company_id, doc_no, invoice_id, partner_id, org_project_id, reason, note_date, description, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, irn_required, irn_due_date, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(actor.companyId, docNo(actor.companyId, 'ar_credit_notes', 'CN'), v.inv.id, v.inv.partner_id, v.inv.org_project_id, b.reason, b.noteDate, b.description, v.taxable, v.s.cgst, v.s.sgst, v.s.igst, v.total, v.irn, v.irnDue, actor.user, actor.user, 'ar_invoices', String(v.inv.id)).lastInsertRowid); audit(actor, 'ar_credit_notes', id, 'create', actor.companyId, { newValues: { total: rs(v.total), reason: b.reason } }); return notes.get(actor, id); });
    },
    submit(actor, id) { cnFlow.submit(actor, id); return notes.get(actor, id); },
    withdraw(actor, id, b) { cnFlow.withdraw(actor, id, b); return notes.get(actor, id); },
    cancel(actor, id, b) { cnFlow.cancel(actor, id, b); return notes.get(actor, id); },
    remove(actor, id) { return cnFlow.remove(actor, id); },
    history(actor, id) { return cnFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return cnFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- write-off (accounts manager, CFO, director) ----
  const woFlow = createFlow({
    db, base, docType: AR_WO_DOC, table: 'ar_writeoffs', perm: 'fin.writeoff', label: 'write-off', route: '/finance/receivables?wo=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: null }), ctx: (r) => ({ total: rs(r.amount_paise) }), title: (r) => `Write-off ${money(r.amount_paise)}: ${r.reason}`, notifyCode: 'fin.ar.decided', numberKey: 'FIN_AR_WO', prefix: 'WO',
    beforeSubmit: (_a, r) => { const inv = db.prepare('SELECT * FROM ar_invoices WHERE id = ?').get(r.invoice_id); if (r.amount_paise > balance(inv)) throw unprocessable(`The write-off is more than the invoice has open (${money(balance(inv))}).`); },
    onApproved: (actor, r) => {
      const w = db.prepare('SELECT * FROM ar_writeoffs WHERE id = ?').get(r.id); const d = w.org_project_id ? { projectId: w.org_project_id } : {};
      const j = gl.postEngine(w.company_id, { voucherType: 'JV', date: todayIST(), narration: `Write-off ${w.doc_no}: ${w.reason}`.slice(0, 500), sourceType: 'ar_writeoffs', sourceId: w.id, lines: [{ accountId: acct(w.company_id, '560010'), debit: rs(w.amount_paise), ...d }, { accountId: acct(w.company_id, '140001'), credit: rs(w.amount_paise), partnerId: w.partner_id, ...d }], user: actor.user });
      db.prepare('UPDATE ar_writeoffs SET journal_id = ? WHERE id = ?').run(j.journal.id, w.id); db.prepare('UPDATE ar_invoices SET written_off_paise = written_off_paise + ?, version = version + 1 WHERE id = ?').run(w.amount_paise, w.invoice_id);
      publishEvent(db, { type: 'fin.ar.written_off', entity: 'ar_writeoffs', entityId: w.id, actorId: actor.user, companyId: w.company_id, data: { writeoffId: w.id, docNo: w.doc_no, invoiceId: w.invoice_id, partnerId: w.partner_id, amount: rs(w.amount_paise), reason: w.reason } });
    },
  });
  const woView = (actor, w, detail = false) => ({ id: w.id, docNo: w.doc_no, invoiceId: w.invoice_id, client: partnerOf(w.company_id, w.partner_id)?.legal_name, amount: rs(w.amount_paise), reason: w.reason, date: w.writeoff_date, journalId: w.journal_id, status: w.status, statusLabel: STATUS[w.status], version: w.version, can: woFlow.can(actor, w), ...(detail ? woFlow.approveInfo(actor, w) : {}) });
  const writeoffs = {
    flow: woFlow,
    get(actor, id) { return woView(actor, woFlow.row(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.writeoff.create', 'propose write-offs'); const inv = invRow(actor, b.invoiceId); const amt = paise(b.amount);
      if (inv.status !== 'APPROVED' || !(amt > 0) || amt > balance(inv)) throw badRequest('Correct the highlighted fields', [{ field: 'amount', message: `At most ${money(balance(inv))} is open on ${inv.doc_no}.` }]);
      return transaction(db, () => { const id = Number(db.prepare('INSERT INTO ar_writeoffs (company_id, doc_no, invoice_id, partner_id, org_project_id, amount_paise, reason, writeoff_date, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, docNo(actor.companyId, 'ar_writeoffs', 'WO'), inv.id, inv.partner_id, inv.org_project_id, amt, b.reason, todayIST(), actor.user, actor.user, 'ar_invoices', String(inv.id)).lastInsertRowid); audit(actor, 'ar_writeoffs', id, 'create', actor.companyId, { newValues: { amount: rs(amt) }, reason: b.reason }); return writeoffs.get(actor, id); });
    },
    submit(actor, id) { woFlow.submit(actor, id); return writeoffs.get(actor, id); },
    withdraw(actor, id, b) { woFlow.withdraw(actor, id, b); return writeoffs.get(actor, id); },
    cancel(actor, id, b) { woFlow.cancel(actor, id, b); return writeoffs.get(actor, id); },
    history(actor, id) { return woFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return woFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-05: collections ----
  const followups = {
    add(actor, invoiceId, b) {
      const r = invRow(actor, invoiceId); if (!may(actor, 'fin.followup.create', r.org_project_id)) throw forbidden('You may not log follow-ups (permission fin.followup.create).');
      if (r.status !== 'APPROVED' || balance(r) <= 0) throw unprocessable('Follow-ups are logged on an open receivable.');
      if (b.promisedDate && b.promisedDate < b.date) throw badRequest('Correct the highlighted fields', [{ field: 'promisedDate', message: 'The promised date is on or after the follow-up.' }]);
      return transaction(db, () => {
        db.prepare('INSERT INTO ar_followups (company_id, invoice_id, partner_id, org_project_id, followup_date, action, notes, contact_person, promised_date, promised_paise, next_date, by_user, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(r.company_id, r.id, r.partner_id, r.org_project_id, b.date, b.action, b.notes, b.contact ?? null, b.promisedDate ?? null, b.promised != null ? paise(b.promised) : null, b.nextDate ?? null, actor.user, actor.user, 'ar_invoices', String(r.id));
        db.prepare('UPDATE ar_invoices SET promised_date = COALESCE(?, promised_date), last_followup_at = ?, version = version + 1 WHERE id = ?').run(b.promisedDate ?? null, nowIso(), r.id);
        audit(actor, 'ar_invoices', r.id, 'followup', r.company_id, { newValues: { action: b.action, promised: b.promisedDate ?? null } });
        return invoices.get(actor, r.id);
      });
    },
    /** The worklist: open receivables past due (or promised), the most overdue first; the colour by the days overdue. */
    worklist(actor, /** @type {{ partnerId?: any, projectId?: any, bucket?: string }} */ { partnerId, projectId, bucket } = {}) {
      const sc = scope(actor, 'fin.followup.view').replace(/x\.site_id/g, 'NULL'); const today = todayIST();
      const rows = db.prepare(`SELECT x.* FROM ar_invoices x WHERE ${sc} AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.amount_paise - x.received_paise - x.credited_paise - x.written_off_paise > 0 AND (x.due_date < :t OR x.promised_date IS NOT NULL)
          AND (:par = 0 OR x.partner_id = :par) AND (:proj = 0 OR x.org_project_id = :proj) ORDER BY x.due_date, x.id LIMIT 300`).all({ c: actor.companyId, t: today, par: Number(partnerId ?? 0), proj: Number(projectId ?? 0) });
      const out = rows.map((r) => { const v = invView(actor, r); const sla = v.daysOverdue > 90 ? 'RED' : v.daysOverdue > 30 ? 'AMBER' : v.daysOverdue > 0 ? 'YELLOW' : 'GREEN'; const broken = r.promised_date && r.promised_date < today; return { ...v, sla, promiseBroken: Boolean(broken) }; })
        .filter((r) => !bucket || (bucket === '90' ? r.daysOverdue > 90 : bucket === '60' ? r.daysOverdue > 60 && r.daysOverdue <= 90 : bucket === '30' ? r.daysOverdue > 30 && r.daysOverdue <= 60 : r.daysOverdue <= 30));
      return { rows: out, count: out.length, overdue: rs(out.reduce((s, r) => s + paise(r.balance), 0)), brokenPromises: out.filter((r) => r.promiseBroken).length };
    },
    /** The daily job: a promise not kept escalates once to the accounts manager (and the follow-up log says so). */
    escalate(companyId, today = todayIST()) {
      const rows = db.prepare("SELECT * FROM ar_invoices WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND promised_date IS NOT NULL AND promised_date < ? AND amount_paise - received_paise - credited_paise - written_off_paise > 0 AND NOT EXISTS (SELECT 1 FROM ar_followups f WHERE f.invoice_id = ar_invoices.id AND f.action = 'ESCALATION' AND f.followup_date >= ar_invoices.promised_date)").all(companyId, today);
      for (const r of rows) transaction(db, () => {
        db.prepare("INSERT INTO ar_followups (company_id, invoice_id, partner_id, org_project_id, followup_date, action, notes, by_user, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'ESCALATION', ?, 'system', 'system', 'fin.ar_daily')").run(r.company_id, r.id, r.partner_id, r.org_project_id, today, `Payment promised for ${r.promised_date} not received; ${money(balance(r))} open.`);
        notify(r.company_id, 'fin.ar.followup', ['permission:fin.invoice.approve'], r.doc_no, 'promise broken', `${partnerOf(r.company_id, r.partner_id)?.legal_name ?? ''} promised to pay ${r.doc_no} by ${r.promised_date}; ${money(balance(r))} is still open.`, `/finance/receivables?id=${r.id}`, r.id);
      });
      return rows.length;
    },
  };

  const salesDays = (companyId) => Number(param(companyId, 'fin.ar.dso_days') ?? 90);
  const dsoOf = (total, sales, days) => sales > 0 ? Math.round((total / sales) * days) : null;
  const outstanding = 'x.amount_paise - x.received_paise - x.credited_paise - x.written_off_paise';

  // ---- FR-06: ageing, DSO, the client statement; FR-03 the TDS deducted by clients ----
  function ageing(actor, /** @type {{ asOf?: string, projectId?: any }} */ { asOf, projectId } = {}) {
    const d = asOf ?? todayIST(); const sc = scope(actor, 'fin.invoice.view').replace(/x\.site_id/g, 'NULL');
    const rows = db.prepare(`SELECT p.legal_name AS client, x.partner_id AS partnerId, SUM(CASE WHEN age <= 0 THEN o ELSE 0 END) AS cur, SUM(CASE WHEN age BETWEEN 1 AND 30 THEN o ELSE 0 END) AS b1, SUM(CASE WHEN age BETWEEN 31 AND 60 THEN o ELSE 0 END) AS b31, SUM(CASE WHEN age BETWEEN 61 AND 90 THEN o ELSE 0 END) AS b61, SUM(CASE WHEN age > 90 THEN o ELSE 0 END) AS b91, SUM(o) AS total
      FROM (SELECT x.*, ${outstanding} AS o, CAST(julianday(:d) - julianday(x.due_date) AS INTEGER) AS age FROM ar_invoices x WHERE ${sc} AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.invoice_date <= :d AND (:proj = 0 OR x.org_project_id = :proj)) x
      JOIN mdm_partners p ON p.id = x.partner_id WHERE x.o > 0 GROUP BY x.partner_id ORDER BY total DESC`).all({ c: actor.companyId, d, proj: Number(projectId ?? 0) });
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const days = salesDays(actor.companyId);
    const sales = db.prepare(`SELECT COALESCE(SUM(x.amount_paise), 0) AS s FROM ar_invoices x WHERE ${sc} AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.invoice_date > date(:d, :back) AND x.invoice_date <= :d AND (:proj = 0 OR x.org_project_id = :proj)`).get({ c: actor.companyId, d, back: `-${days} days`, proj: Number(projectId ?? 0) }).s;
    const total = sum('total');
    return { asOf: d, rows: rows.map((r) => ({ client: r.client, partnerId: r.partnerId, current: rs(r.cur), b1: rs(r.b1), b31: rs(r.b31), b61: rs(r.b61), b91: rs(r.b91), total: rs(r.total) })), totals: { current: rs(sum('cur')), b1: rs(sum('b1')), b31: rs(sum('b31')), b61: rs(sum('b61')), b91: rs(sum('b91')), total: rs(total) }, dso: dsoOf(total, sales, days), dsoDays: days, sales: rs(sales) };
  }

  function* approvedMetricFacts(companyId, asOf, projectId = null) {
    const days = salesDays(companyId);
    const rows = db.prepare(`SELECT x.org_project_id AS projectId, SUM(MAX(${outstanding}, 0)) AS total,
      SUM(CASE WHEN x.invoice_date > date(:asOf, :back) THEN x.amount_paise ELSE 0 END) AS sales
      FROM ar_invoices x JOIN org_projects p ON p.id = x.org_project_id AND p.company_id = x.company_id AND p.deleted_at IS NULL
      WHERE x.company_id = :companyId AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.invoice_date <= :asOf
        ${projectId == null ? '' : 'AND x.org_project_id = :projectId'}
      GROUP BY x.org_project_id`).iterate({ companyId, asOf, back: `-${days} days`, ...(projectId == null ? {} : { projectId }) });
    for (const row of rows) {
      yield { projectId: row.projectId, sourceId: row.projectId, sourcePeriod: asOf,
        sourceVersion: 1, dso: dsoOf(row.total, row.sales, days) };
    }
  }
  function statement(actor, { partnerId, from, to }) {
    need(actor, 'fin.invoice.view', 'see client statements'); const p = partnerOf(actor.companyId, partnerId); if (!p) throw notFound('That client does not exist.');
    const upTo = to ?? todayIST(); const start = from ?? '0000-01-01'; const c = actor.companyId; const sc = scope(actor, 'fin.invoice.view').replace(/x\.site_id/g, 'NULL');
    const entries = [
      ...db.prepare(`SELECT x.id, x.doc_no, x.invoice_no, x.invoice_date AS d, x.amount_paise FROM ar_invoices x WHERE ${sc} AND x.partner_id = :p AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.invoice_date <= :u`).all({ c, p: p.id, u: upTo }).map((x) => ({ d: x.d, kind: 'INVOICE', ref: x.invoice_no ?? x.doc_no, debit: x.amount_paise, credit: 0, link: `/finance/receivables?id=${x.id}` })),
      ...db.prepare("SELECT id, doc_no, receipt_date AS d, reference, amount_paise, tds_paise, gst_tds_paise, retention_paise, other_ded_paise FROM ar_receipts WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND receipt_date <= ?").all(c, p.id, upTo).flatMap((x) => [{ d: x.d, kind: 'RECEIPT', ref: `${x.doc_no}${x.reference ? ` · ${x.reference}` : ''}`, debit: 0, credit: x.amount_paise, link: `/finance/receivables?receipt=${x.id}` }, ...(x.tds_paise + x.gst_tds_paise + x.retention_paise + x.other_ded_paise ? [{ d: x.d, kind: 'DEDUCTION', ref: `${x.doc_no} (TDS ${money(x.tds_paise)}, GST-TDS ${money(x.gst_tds_paise)}, retention ${money(x.retention_paise)}, other ${money(x.other_ded_paise)})`, debit: 0, credit: x.tds_paise + x.gst_tds_paise + x.retention_paise + x.other_ded_paise }] : [])]),
      ...db.prepare("SELECT doc_no, note_date AS d, total_paise, reason FROM ar_credit_notes WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND note_date <= ?").all(c, p.id, upTo).map((x) => ({ d: x.d, kind: 'CREDIT_NOTE', ref: `${x.doc_no} · ${CN_REASONS[x.reason]}`, debit: 0, credit: x.total_paise })),
      ...db.prepare("SELECT doc_no, writeoff_date AS d, amount_paise FROM ar_writeoffs WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND writeoff_date <= ?").all(c, p.id, upTo).map((x) => ({ d: x.d, kind: 'WRITE_OFF', ref: x.doc_no, debit: 0, credit: x.amount_paise })),
    ].sort((a, b) => a.d.localeCompare(b.d) || (a.kind === 'INVOICE' ? -1 : 1));
    let bal = 0; let opening = 0; const rows = [];
    for (const e of entries) { bal += e.debit - e.credit; if (e.d < start) { opening = bal; continue; } rows.push({ ...e, debit: rs(e.debit), credit: rs(e.credit), balance: rs(bal) }); }
    return { client: { id: p.id, code: p.code, name: p.legal_name }, from: from ?? null, to: upTo, opening: rs(opening), closing: rs(bal), rows };
  }
  function statementPdf(actor, q) { need(actor, 'fin.invoice.export', 'print client statements'); const s = statement(actor, q); audit(actor, 'ar_invoices', 0, 'statement', actor.companyId, { reason: s.client.code }); return { buffer: toPdf({ columns: [{ key: 'd', label: 'Date', type: 'text' }, { key: 'kind', label: 'Entry', type: 'text' }, { key: 'ref', label: 'Reference', type: 'text' }, { key: 'debit', label: 'Debit', type: 'number' }, { key: 'credit', label: 'Credit', type: 'number' }, { key: 'balance', label: 'Balance', type: 'number' }], rows: [{ d: '', kind: 'Opening', ref: '', debit: null, credit: null, balance: s.opening }, ...s.rows], footer: [`${s.client.name} · to ${s.to} · balance due ₹${(s.closing ?? 0).toFixed(2)}`], title: `Statement of account — ${s.client.name}` }), contentType: 'application/pdf', fileName: `client-statement-${s.client.code}-${s.to}.pdf` }; }
  function tdsReceivable(actor, { from, to }) {
    need(actor, 'fin.receipt.view', 'see the TDS deducted by clients');
    const rows = db.prepare("SELECT r.*, p.legal_name, p.pan FROM ar_receipts r JOIN mdm_partners p ON p.id = r.partner_id WHERE r.company_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL AND (r.tds_paise > 0 OR r.gst_tds_paise > 0) AND r.receipt_date BETWEEN ? AND ? ORDER BY r.receipt_date").all(actor.companyId, from ?? '0000-01-01', to ?? '9999-12-31')
      .map((r) => ({ id: r.id, docNo: r.doc_no, date: r.receipt_date, client: r.legal_name, pan: r.pan ? `${r.pan.slice(0, 2)}•••••${r.pan.slice(-3)}` : null, section: r.tds_section, quarter: r.tds_quarter, tds: rs(r.tds_paise), gstTds: rs(r.gst_tds_paise), matched: Boolean(r.tds_matched_26as) }));
    return { rows, tds: rs(rows.reduce((s, r) => s + paise(r.tds), 0)), gstTds: rs(rows.reduce((s, r) => s + paise(r.gstTds), 0)), unmatched: rs(rows.filter((r) => !r.matched).reduce((s, r) => s + paise(r.tds), 0)) };
  }
  const clients = (actor) => { need(actor, 'fin.invoice.view', 'see clients'); return db.prepare("SELECT p.id, p.code, p.legal_name AS name FROM mdm_partners p WHERE p.company_id = ? AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL) ORDER BY p.legal_name LIMIT 500").all(actor.companyId); };

  return { consumers, invoices, receipts, notes, writeoffs, followups, ageing, statement, statementPdf, tdsReceivable, clients, balance, approvedMetricFacts };
}
