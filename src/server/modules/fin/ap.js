import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { findFinancialYear } from '../core/financial-years/service.js';
import { statutoryResolver } from '../mdm/statutory.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.03: accounts payable. An AP bill is the payable of a vendor, a subcontractor or an employee: made by itself when a vendor invoice is matched (22.06), a
// subcontractor bill approved (22.05) or an expense claim passed (07.12), or typed as a direct expense bill (no purchase order: approved by the head of the maker's
// department, the accounts manager and, above the limit, the CFO). Its TDS is resolved by the nature of the payment on the bill's date (166.8: 194C to 31-03-2026,
// s.393(1) from 01-04-2026) with the thresholds counted per financial year, partner and nature (BR-01: when the annual threshold is crossed the whole year's amount is
// taxed, less what was deducted), the rate of the partner's constitution, the rate without a PAN, or a lower-deduction certificate; the TDS is posted (Dr payable,
// Cr TDS payable). Its due date comes from the payment terms; an MSME (micro or small) vendor's bill carries the date of Section 43B(h) (agreed days, at most 45;
// 15 without an agreement). A bill can be held (a dispute, the partner's hold, a bank account in its cooling-off, a subcontractor's compliance hold) and a held bill
// is not offered for payment (BR-02). Debit notes and vendors' credit notes are approved by the accounts manager and posted; an advance given is set against a bill.
// The vendor ledger and statement, the payables ageing, the MSME due report and the TDS deducted are read from the bills, notes and adjustments.

export const AP_DIRECT_DOC = 'FIN_AP_DIRECT';
export const AP_DN_DOC = 'FIN_DEBIT_NOTE';
export const SOURCES = { VENDOR_INVOICE: 'Vendor invoice (22.06)', SUB_BILL: 'Subcontractor bill (22.05)', EXPENSE_CLAIM: 'Expense claim (07.12)', HIRE_BILL: 'Hire bill (17.06)', DIRECT: 'Direct expense bill' };
export const DN_REASONS = { RTV: 'Return to vendor', RATE_DIFFERENCE: 'Rate difference', BACK_CHARGE: 'Back-charge', PENALTY: 'Penalty', SHORT_SUPPLY: 'Short supply', OTHER: 'Other' };
const NATURE_OF_KIND = { PO: 'PURCHASE_GOODS', SERVICE: 'CONTRACTOR', HIRE: 'RENT_PLANT' };
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const toRupee = (p) => Math.round(p / 100) * 100; // TDS is rounded to the rupee

for (const [key, dataType, def, description] of [
  ['fin.ap.tds_no_pan_pct', 'decimal', '20', 'Part 23.03 FR-02: the TDS rate (per cent) when the payee has no valid PAN, or twice the section rate if that is higher (s.206AA of the 1961 Act; its 2025 Act counterpart is to be confirmed, D-709).'],
  ['fin.ap.tds_goods_purchase', 'boolean', false, 'Part 23.03 FR-02: whether the company deducts TDS on the purchase of goods (194Q / s.393 PURCHASE_GOODS): only a buyer whose turnover was above ₹10 crore in the previous year does. Then the TDS is on the purchases above the threshold of the year.'],
  ['fin.ap.direct_cfo_limit', 'integer', 100000, 'Part 23.03 §9: a direct expense bill above this many rupees is approved by the CFO after the accounts manager.'],
  ['fin.ap.default_credit_days', 'integer', 30, 'Part 23.03 FR-05: the days to the due date of a direct expense bill when none are given.'],
  ['fin.ap.msme_days_agreed_max', 'integer', 45, 'Part 23.03 FR-05: Section 43B(h) with s.15 of the MSMED Act: a micro or small enterprise is paid within the agreed days, at most 45.'],
  ['fin.ap.msme_days_no_agreement', 'integer', 15, 'Part 23.03 FR-05: Section 43B(h): without a written agreement, within 15 days.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

export const apList = defineList({
  code: 'fin.ap_bills', label: 'AP bills', permission: 'fin.bill.view',
  from: 'ap_bills x LEFT JOIN mdm_partners p ON p.id = x.partner_id', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'AP bill' }, payee: { sql: 'x.payee_name', type: 'text', label: 'Payee' }, billNo: { sql: "COALESCE(x.bill_no, '')", type: 'text', label: 'Their bill' },
    source: { sql: 'x.bill_source', type: 'enum', label: 'From', options: Object.entries(SOURCES) }, billDate: { sql: 'x.bill_date', type: 'date', label: 'Bill date' }, dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' },
    msmeDue: { sql: 'x.msme_due_date', type: 'date', label: 'MSME due' }, total: { sql: '(x.total_paise / 100.0)', type: 'money', label: 'Bill amount' }, tds: { sql: '(x.tds_paise / 100.0)', type: 'money', label: 'TDS' },
    outstanding: { sql: '((x.net_payable_paise - x.adjusted_paise - x.paid_paise) / 100.0)', type: 'money', label: 'Outstanding' },
    hold: { sql: "(CASE WHEN x.hold_reason IS NOT NULL OR p.payment_hold_until >= date('now') THEN 'On hold' ELSE '' END)", type: 'text', label: 'Hold' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) },
  },
});
export const dnList = defineList({
  code: 'fin.debit_notes', label: 'Debit notes', permission: 'fin.debit_note.view',
  from: 'ap_debit_notes x JOIN mdm_partners p ON p.id = x.partner_id', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Note' }, partner: { sql: 'p.legal_name', type: 'text', label: 'Vendor' }, kind: { sql: 'x.note_kind', type: 'enum', label: 'Kind', options: [['DEBIT', 'Debit note'], ['VENDOR_CREDIT', 'Credit note from the vendor']] },
    reason: { sql: 'x.reason', type: 'enum', label: 'Reason', options: Object.entries(DN_REASONS) }, noteDate: { sql: 'x.note_date', type: 'date', label: 'Date' }, total: { sql: '(x.total_paise / 100.0)', type: 'money', label: 'Amount' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) },
  },
});

/** @param {{ db: any, base: any, gl: any, flags: any }} o */
export function createApService({ db, base, gl, flags }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key, date = todayIST()) => createParameterStore(db).get(key, { companyId, date });
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2303');
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const partnerOf = (companyId, id) => (id ? db.prepare('SELECT * FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), companyId) : null);
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };

  // ---- FR-02, BR-01: TDS ----
  /**
   * The TDS of a payment of `basePaise` (excluding GST) to a partner for a nature of payment on a date: the section in force (166.8), the rate (lower-deduction
   * certificate, no PAN, or the partner's constitution), the thresholds counted over the financial year of the date for that partner and nature, other bills excluded.
   */
  function tdsFor(companyId, { partnerId, nature, date, basePaise, excludeBillId = 0 }) {
    const none = (basis) => ({ nature, section: null, act: null, rate: 0, ratePct: '0', base: basePaise, amount: 0, basis, paymentCode: null, certificate: null, ldcNo: null });
    if (!nature || !partnerId) return none('NO_PARTNER');
    if (nature === 'PURCHASE_GOODS' && !param(companyId, 'fin.ap.tds_goods_purchase', date)) return none('NOT_APPLICABLE');
    const p = partnerOf(companyId, partnerId); const t = statutoryResolver(db).tds(companyId, { nature, date, constitution: p?.constitution ?? null });
    if (!t) return none('NO_SECTION');
    const fy = findFinancialYear(db, companyId, date);
    const prior = db.prepare("SELECT COALESCE(SUM(tds_base_paise), 0) AS b, COALESCE(SUM(tds_paise), 0) AS t FROM ap_bills WHERE company_id = ? AND partner_id = ? AND tds_nature = ? AND status = 'APPROVED' AND bill_date BETWEEN ? AND ? AND id != ?").get(companyId, partnerId, nature, fy?.start_date ?? date, fy?.end_date ?? date, excludeBillId);
    let rate = Math.round(Number(t.pct) * 10000); let basis = 'RATE'; let ldcNo = null;
    const ldc = db.prepare('SELECT * FROM mdm_partner_tds WHERE partner_id = ? AND company_id = ? AND ldc_no IS NOT NULL AND ldc_rate IS NOT NULL AND (valid_from IS NULL OR valid_from <= ?) AND (valid_until IS NULL OR valid_until >= ?) AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(partnerId, companyId, date, date);
    if (ldc) {
      const used = db.prepare("SELECT COALESCE(SUM(tds_base_paise), 0) AS b FROM ap_bills WHERE company_id = ? AND partner_id = ? AND ldc_no = ? AND status = 'APPROVED' AND id != ?").get(companyId, partnerId, ldc.ldc_no, excludeBillId).b;
      if (ldc.ldc_limit == null || used + basePaise <= ldc.ldc_limit) { rate = ldc.ldc_rate; basis = 'LDC'; ldcNo = ldc.ldc_no; }
    }
    if (basis !== 'LDC' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(p?.pan ?? ''))) { const noPan = Math.round(Number(param(companyId, 'fin.ap.tds_no_pan_pct', date) ?? 20) * 10000); rate = Math.max(noPan, rate * 2 > noPan ? rate : noPan); basis = 'NO_PAN'; }
    const single = paise(t.thresholdSingle ?? 0); const annual = paise(t.thresholdAnnual ?? 0); const cumulative = prior.b + basePaise;
    let amount = 0;
    if (nature === 'PURCHASE_GOODS') { const over = Math.max(0, cumulative - Math.max(annual, prior.b)); amount = toRupee(Math.round((Math.min(over, basePaise) * rate) / 1_000_000)); if (!amount) basis = 'BELOW_THRESHOLD'; }
    else if ((!single && !annual) || (single && basePaise > single) || (annual && cumulative > annual)) {
      // crossing the annual threshold: the whole year's amount is taxed, less what was already deducted (BR-01)
      const crossing = annual && cumulative > annual && prior.b <= annual && !(single && basePaise > single);
      amount = crossing ? Math.max(0, toRupee(Math.round((cumulative * rate) / 1_000_000)) - prior.t) : toRupee(Math.round((basePaise * rate) / 1_000_000));
      if (crossing) basis = basis === 'RATE' ? 'ANNUAL_CROSSED' : basis;
    } else basis = 'BELOW_THRESHOLD';
    return { nature, section: t.section, act: t.act, rate, ratePct: (rate / 10000).toFixed(4).replace(/\.?0+$/, ''), base: basePaise, amount, basis, paymentCode: t.paymentCode, certificate: t.certificate, ldcNo, cumulative, thresholdSingle: single, thresholdAnnual: annual };
  }

  // ---- FR-05: due dates, MSME, holds ----
  function msmeOf(companyId, partner, billDate, creditDays) {
    if (!partner || !['MICRO', 'SMALL'].includes(partner.msme_category)) return { msme: 0, msmeDue: null };
    const days = creditDays != null ? Math.min(Number(creditDays), Number(param(companyId, 'fin.ap.msme_days_agreed_max', billDate) ?? 45)) : Number(param(companyId, 'fin.ap.msme_days_no_agreement', billDate) ?? 15);
    return { msme: 1, msmeDue: addDays(billDate, days) };
  }
  /** Why a bill cannot be paid now: its own hold, the partner's, a bank account in its cooling-off, a subcontractor's compliance hold on the project. */
  function holdsOf(b, today = todayIST()) {
    const h = [];
    if (b.hold_reason) h.push({ code: 'BILL', reason: b.hold_reason, by: b.hold_by });
    const p = b.partner_id ? db.prepare('SELECT payment_hold_until, payment_hold_reason FROM mdm_partners WHERE id = ?').get(b.partner_id) : null;
    if (p?.payment_hold_until && p.payment_hold_until >= today) h.push({ code: 'PARTNER', reason: p.payment_hold_reason ?? `Partner on hold until ${p.payment_hold_until}` });
    const bank = b.partner_id ? db.prepare("SELECT cooling_off_until FROM mdm_partner_banks WHERE partner_id = ? AND deleted_at IS NULL AND cooling_off_until >= ? ORDER BY id DESC LIMIT 1").get(b.partner_id, today) : null;
    if (bank) h.push({ code: 'BANK_CHANGE', reason: `Bank account changed: payments wait until ${bank.cooling_off_until}` });
    const sub = b.partner_id && b.org_project_id ? db.prepare('SELECT reasons_json FROM ctr_sub_holds WHERE subcontractor_id = ? AND org_project_id = ? AND company_id = ? AND hold = 1').get(b.partner_id, b.org_project_id, b.company_id) : null;
    if (sub) h.push({ code: 'COMPLIANCE', reason: `Subcontractor compliance hold: ${(JSON.parse(sub.reasons_json || '[]')).join(', ') || 'see the compliance page'}` });
    return h;
  }
  const outstanding = (b) => b.net_payable_paise - b.adjusted_paise - b.paid_paise;

  // ---- posting (through the general ledger's engine entry, 23.01) ----
  const apAccount = (companyId, partner) => acct(companyId, partner && db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role = 'SUBCONTRACTOR' AND deleted_at IS NULL").get(partner.id) ? '220002' : '220001');
  const ownStates = (companyId) => { const s = db.prepare('SELECT gstins_json FROM core_company_settings WHERE company_id = ?').get(companyId); const a = s ? JSON.parse(s.gstins_json || '[]').map((g) => g.stateCode ?? String(g.gstin ?? '').slice(0, 2)) : []; const b = db.prepare("SELECT COALESCE(state_code, substr(gstin, 1, 2)) AS st FROM org_branches WHERE company_id = ? AND gstin IS NOT NULL AND gstin <> '' AND deleted_at IS NULL").all(companyId).map((r) => r.st); return new Set([...a, ...b].filter(Boolean).map(String)); };
  /** GST input lines of an amount, split by the state of supply; throws when there is tax and the state cannot be told (no guess). */
  function gstLines(companyId, partner, gstPaise, side) {
    if (!gstPaise) return [];
    const g = partner ? db.prepare("SELECT gstin FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(partner.id)?.gstin : null; const own = ownStates(companyId);
    if (!g || !own.size) throw unprocessable('The state of supply cannot be told: the GSTIN of the partner or the company\'s own GSTIN is missing. Add it, then try again.');
    const k = side === 'DR' ? 'debit' : 'credit';
    if (!own.has(String(g).slice(0, 2))) return [{ accountId: acct(companyId, '170003'), [k]: rs(gstPaise) }];
    const half = Math.round(gstPaise / 2); return [{ accountId: acct(companyId, '170001'), [k]: rs(half) }, { accountId: acct(companyId, '170002'), [k]: rs(gstPaise - half) }];
  }
  const postTds = (b) => {
    if (!b.tds_paise || !gl) return null;
    const p = partnerOf(b.company_id, b.partner_id); const ap = apAccount(b.company_id, p);
    const r = gl.postEngine(b.company_id, { voucherType: 'JV', date: b.bill_date, narration: `TDS ${b.tds_section} on ${b.doc_no} ${b.payee_name}`, sourceType: 'ap_bills', sourceId: b.id, lines: [{ accountId: ap, debit: rs(b.tds_paise), partnerId: b.partner_id, ...(b.org_project_id ? { projectId: b.org_project_id } : {}) }, { accountId: acct(b.company_id, '230004'), credit: rs(b.tds_paise), partnerId: b.partner_id }] });
    return r.journal.id;
  };

  // ---- FR-01: bills from the other modules (by their events) ----
  function insertBill(companyId, o) {
    const p = partnerOf(companyId, o.partnerId); const m = msmeOf(companyId, p, o.billDate, o.creditDays ?? (o.dueDate ? daysBetween(o.billDate, o.dueDate) : null));
    const id = Number(db.prepare(`INSERT INTO ap_bills (company_id, doc_no, bill_source, source_ref, org_project_id, org_site_id, partner_id, employee_id, payee_name, bill_no, bill_date, due_date, msme, msme_due_date, description, expense_account_id,
        gross_paise, gst_input_paise, total_paise, tds_nature, tds_section, tds_act, tds_rate, tds_base_paise, tds_paise, tds_payment_code, tds_certificate, tds_basis, ldc_no, net_payable_paise, status, requested_by, approved_by, approved_at, created_by, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(companyId, docNo(companyId, 'ap_bills', 'APB'), o.source, o.sourceRef ?? null, o.projectId ?? null, o.siteId ?? null, o.partnerId ?? null, o.employeeId ?? null, o.payee, o.billNo ?? null, o.billDate, o.dueDate, m.msme, m.msmeDue, o.description ?? null, o.expenseAccountId ?? null,
        o.gross, o.gst, o.total, o.tds?.nature ?? null, o.tds?.section ?? null, o.tds?.act ?? null, o.tds?.rate ?? 0, o.tds?.base ?? 0, o.tds?.amount ?? 0, o.tds?.paymentCode ?? null, o.tds?.certificate ?? null, o.tds?.basis ?? null, o.tds?.ldcNo ?? null,
        Math.max(0, o.total - (o.tds?.amount ?? 0)), o.status, o.user, o.status === 'APPROVED' ? o.user : null, o.status === 'APPROVED' ? nowIso() : null, o.user, o.sourceType ?? 'ap_bills', o.sourceId == null ? null : String(o.sourceId)).lastInsertRowid);
    return db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(id);
  }
  const consumers = {
    /** A vendor invoice matched and approved (22.06): the AP bill with its TDS (by the nature of the invoice's kind, or the partner's TDS profile); the TDS posted. */
    onInvoice(e) {
      const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || !d.invoiceId) return null;
      if (db.prepare("SELECT 1 FROM ap_bills WHERE company_id = ? AND bill_source = 'VENDOR_INVOICE' AND source_ref = ? AND status != 'CANCELLED'").get(c, String(d.invoiceId))) return null;
      const p = partnerOf(c, d.vendorId); const prof = p ? db.prepare('SELECT section FROM mdm_partner_tds WHERE partner_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(p.id) : null;
      const nature = (prof ? db.prepare('SELECT nature_code FROM mdm_tds_sections WHERE section = ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1').get(prof.section)?.nature_code : null) ?? NATURE_OF_KIND[d.kind] ?? 'CONTRACTOR';
      return transaction(db, () => {
        const tds = tdsFor(c, { partnerId: d.vendorId, nature, date: d.invoiceDate, basePaise: paise(d.taxable ?? 0) });
        const b = insertBill(c, { source: 'VENDOR_INVOICE', sourceRef: String(d.invoiceId), sourceType: 'bill_vendor_invoices', sourceId: d.invoiceId, projectId: d.projectId, partnerId: d.vendorId, payee: p?.legal_name ?? `Vendor ${d.vendorId}`, billNo: d.invoiceNo, billDate: d.invoiceDate, dueDate: d.dueDate ?? addDays(d.invoiceDate, 30), gross: paise(d.taxable ?? 0), gst: paise(d.tax ?? 0), total: paise(d.total ?? 0), tds, status: 'APPROVED', user: 'system' });
        try { const j = postTds(b); if (j) db.prepare('UPDATE ap_bills SET journal_id = ? WHERE id = ?').run(j, b.id); } catch (x) { db.prepare('UPDATE ap_bills SET remarks = ? WHERE id = ?').run(`TDS not posted: ${x.message}`.slice(0, 500), b.id); notify(c, 'fin.ap.alert', ['permission:fin.bill.approve'], b.doc_no, 'TDS not posted', `The TDS of ${b.doc_no} (${b.payee_name}) was not posted: ${x.message}`, `/finance/ap-bills?id=${b.id}`, b.id); }
        audit({ user: 'system' }, 'ap_bills', b.id, 'create', c, { newValues: { source: 'VENDOR_INVOICE', total: rs(b.total_paise), tds: rs(b.tds_paise) } });
        publishEvent(db, { type: 'fin.ap_bill.created', entity: 'ap_bills', entityId: b.id, actorId: 'system', companyId: c, data: { billId: b.id, docNo: b.doc_no, source: 'VENDOR_INVOICE', partnerId: b.partner_id, netPayable: rs(b.net_payable_paise), dueDate: b.due_date, tds: rs(b.tds_paise), tdsSection: b.tds_section } });
        return b;
      });
    },
    /** A subcontractor bill approved (22.05): its TDS was computed and posted with the bill (166.8 and the SUB rule of 23.02); the AP bill takes it as it is. */
    onSubBill(e) {
      const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || !d.billId) return null;
      if (db.prepare("SELECT 1 FROM ap_bills WHERE company_id = ? AND bill_source = 'SUB_BILL' AND source_ref = ? AND status != 'CANCELLED'").get(c, String(d.billId))) return null;
      const p = partnerOf(c, d.subcontractorId); const t = statutoryResolver(db).tds(c, { nature: 'CONTRACTOR', date: d.periodTo, constitution: p?.constitution ?? null });
      return transaction(db, () => {
        const b = insertBill(c, { source: 'SUB_BILL', sourceRef: String(d.billId), sourceType: 'bill_sub_bills', sourceId: d.billId, projectId: d.projectId, partnerId: d.subcontractorId, payee: p?.legal_name ?? `Subcontractor ${d.subcontractorId}`, billNo: d.billNo, billDate: d.periodTo, dueDate: d.dueDate ?? addDays(d.periodTo, 30), gross: paise(d.gross ?? 0), gst: paise(d.gst ?? 0), total: paise((d.net ?? 0) + (d.tds ?? 0)), tds: { nature: 'CONTRACTOR', section: t?.section ?? null, act: t?.act ?? null, rate: t ? Math.round(Number(t.pct) * 10000) : 0, base: paise(d.gross ?? 0), amount: paise(d.tds ?? 0), paymentCode: t?.paymentCode ?? null, certificate: t?.certificate ?? null, basis: 'SUB_BILL' }, status: 'APPROVED', user: 'system' });
        audit({ user: 'system' }, 'ap_bills', b.id, 'create', c, { newValues: { source: 'SUB_BILL', net: rs(b.net_payable_paise) } });
        return b;
      });
    },
    /** An expense claim passed for payment (07.12): payable to the employee (no TDS). */
    onClaim(e) {
      const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || !d.docNo) return null;
      if (db.prepare("SELECT 1 FROM ap_bills WHERE company_id = ? AND bill_source = 'EXPENSE_CLAIM' AND source_ref = ? AND status != 'CANCELLED'").get(c, String(d.docNo))) return null;
      const emp = db.prepare('SELECT id, full_name FROM hr_employees WHERE id = ? AND company_id = ?').get(Number(d.employeeId), c); if (!emp) return null;
      const date = String(e.occurredAt ?? '').slice(0, 10) || todayIST();
      const b = insertBill(c, { source: 'EXPENSE_CLAIM', sourceRef: String(d.docNo), sourceType: 'exp_claims', sourceId: d.docNo, employeeId: emp.id, payee: emp.full_name, billNo: d.docNo, billDate: date, dueDate: date, gross: paise(d.netPayable ?? 0), gst: 0, total: paise(d.netPayable ?? 0), tds: null, status: 'APPROVED', user: 'system', description: 'Expense claim passed for payment' });
      audit({ user: 'system' }, 'ap_bills', b.id, 'create', c, { newValues: { source: 'EXPENSE_CLAIM', net: rs(b.net_payable_paise) } });
      return b;
    },
  };

  // ---- views ----
  function billView(actor, b, detail = false) {
    const c0 = b.bill_source === 'DIRECT' ? directFlow.can(actor, b) : { edit: false, delete: false, submit: false, withdraw: false, cancel: false, amend: false, print: may(actor, 'fin.bill.print') };
    const holds = b.status === 'APPROVED' ? holdsOf(b) : [];
    const o = { id: b.id, docNo: b.doc_no, source: b.bill_source, sourceLabel: SOURCES[b.bill_source], sourceRef: b.source_ref, projectId: b.org_project_id, partnerId: b.partner_id, employeeId: b.employee_id, payee: b.payee_name, billNo: b.bill_no, billDate: b.bill_date, dueDate: b.due_date, msme: Boolean(b.msme), msmeDue: b.msme_due_date, description: b.description,
      gross: rs(b.gross_paise), gst: rs(b.gst_input_paise), total: rs(b.total_paise), tds: rs(b.tds_paise), tdsSection: b.tds_section, tdsAct: b.tds_act, tdsRate: b.tds_rate / 10000, tdsBase: rs(b.tds_base_paise), tdsBasis: b.tds_basis, tdsCertificate: b.tds_certificate, tdsPaymentCode: b.tds_payment_code, ldcNo: b.ldc_no,
      netPayable: rs(b.net_payable_paise), adjusted: rs(b.adjusted_paise), paid: rs(b.paid_paise), outstanding: rs(outstanding(b)), holds, onHold: holds.length > 0, journalId: b.journal_id, status: b.status, statusLabel: STATUS[b.status], version: b.version, remarks: b.remarks,
      can: { ...c0, hold: b.status === 'APPROVED' && may(actor, 'fin.bill.hold'), adjust: b.status === 'APPROVED' && outstanding(b) > 0 && may(actor, 'fin.bill.approve') } };
    if (detail) {
      const source = b.source_type && b.source_id ? { type: b.source_type, id: b.source_id } : null;
      Object.assign(o, b.bill_source === 'DIRECT' ? directFlow.approveInfo(actor, b) : {}, { sourceDoc: source, adjustments: db.prepare('SELECT * FROM ap_bill_adjustments WHERE bill_id = ? AND deleted_at IS NULL ORDER BY id').all(b.id).map((a) => ({ id: a.id, kind: a.adj_kind, refId: a.ref_id, amount: rs(a.amount_paise), on: a.adjusted_on, journalId: a.journal_id })), debitNotes: db.prepare("SELECT id, doc_no, reason, total_paise, status FROM ap_debit_notes WHERE bill_id = ? AND deleted_at IS NULL").all(b.id).map((n) => ({ id: n.id, docNo: n.doc_no, reason: n.reason, total: rs(n.total_paise), status: n.status })), payments: [], paymentsNote: 'Payments are made from payment proposals (part 23.04).',
        advances: b.partner_id ? db.prepare("SELECT a.id, a.doc_no, a.amount_paise, a.recovered_paise, a.adv_type FROM bill_advances a WHERE a.company_id = ? AND a.party_id = ? AND a.direction = 'GIVEN' AND a.status = 'APPROVED' AND a.deleted_at IS NULL").all(b.company_id, b.partner_id).map((a) => { const used = db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM ap_bill_adjustments WHERE company_id = ? AND adj_kind = 'ADVANCE' AND ref_id = ? AND deleted_at IS NULL").get(b.company_id, a.id).s; return { id: a.id, docNo: a.doc_no, type: a.adv_type, amount: rs(a.amount_paise), available: rs(a.amount_paise - a.recovered_paise - used) }; }).filter((a) => a.available > 0) : [] });
    }
    return o;
  }
  const billRow = (actor, id) => { const b = db.prepare('SELECT * FROM ap_bills WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!b) throw notFound('That AP bill does not exist.'); return b; };

  // ---- the direct expense bill (FR-01, §9: department head → accounts manager → CFO above the limit) ----
  const directFlow = createFlow({
    db, base, docType: AP_DIRECT_DOC, table: 'ap_bills', perm: 'fin.bill', label: 'direct expense bill', route: '/finance/ap-bills?id=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: r.org_site_id ?? null }), ctx: (r) => ({ total: rs(r.total_paise), overCfo: r.total_paise > Number(param(r.company_id, 'fin.ap.direct_cfo_limit') ?? 100000) * 100 ? 1 : 0 }),
    title: (r) => `${r.payee_name} ₹${(r.total_paise / 100).toFixed(2)} ${r.description ?? ''}`, notifyCode: 'fin.ap_bill.decided', numberKey: 'FIN_AP_BILL', prefix: 'APB',
    beforeSubmit: (_a, r) => { const t = tdsFor(r.company_id, { partnerId: r.partner_id, nature: r.tds_nature, date: r.bill_date, basePaise: r.gross_paise, excludeBillId: r.id }); if (t.amount !== r.tds_paise) db.prepare('UPDATE ap_bills SET tds_rate = ?, tds_paise = ?, tds_basis = ?, tds_section = ?, tds_act = ?, net_payable_paise = total_paise - ? WHERE id = ?').run(t.rate, t.amount, t.basis, t.section, t.act, t.amount, r.id); },
    onApproved: (actor, r) => {
      const b = db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(r.id); const p = partnerOf(b.company_id, b.partner_id); const dims = { ...(b.org_project_id ? { projectId: b.org_project_id } : {}), ...(b.org_site_id ? { siteId: b.org_site_id } : {}) };
      const lines = [{ accountId: b.expense_account_id, debit: rs(b.gross_paise), ...dims }, ...gstLines(b.company_id, p, b.gst_input_paise, 'DR'), { accountId: apAccount(b.company_id, p), credit: rs(b.net_payable_paise), partnerId: b.partner_id }, ...(b.tds_paise ? [{ accountId: acct(b.company_id, '230004'), credit: rs(b.tds_paise), partnerId: b.partner_id }] : [])];
      const j = gl.postEngine(b.company_id, { voucherType: 'PJ', date: b.bill_date, narration: `Direct expense bill ${b.doc_no} ${b.payee_name}: ${b.description ?? ''}`.slice(0, 500), sourceType: 'ap_bills', sourceId: b.id, lines, user: actor.user });
      db.prepare('UPDATE ap_bills SET journal_id = ? WHERE id = ?').run(j.journal.id, b.id);
      publishEvent(db, { type: 'fin.ap_bill.created', entity: 'ap_bills', entityId: b.id, actorId: actor.user, companyId: b.company_id, data: { billId: b.id, docNo: b.doc_no, source: 'DIRECT', partnerId: b.partner_id, netPayable: rs(b.net_payable_paise), dueDate: b.due_date, tds: rs(b.tds_paise), tdsSection: b.tds_section } });
    },
  });
  function directValues(actor, b) {
    const p = partnerOf(actor.companyId, b.partnerId); const problems = [];
    if (!p) problems.push({ field: 'partnerId', message: 'Choose the vendor.' });
    const ea = b.expenseAccountId ? db.prepare("SELECT a.* FROM fin_accounts a WHERE a.id = ? AND a.company_id = ? AND a.deleted_at IS NULL AND a.account_status = 'ACTIVE' AND a.is_control = 0").get(Number(b.expenseAccountId), actor.companyId) : null;
    if (!ea) problems.push({ field: 'expenseAccountId', message: 'Choose the expense account (not a control account).' });
    if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(b.projectId), actor.companyId)) problems.push({ field: 'projectId', message: 'The project does not exist.' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    const gross = paise(b.amount); const gst = paise(b.gst ?? 0); const due = b.dueDate ?? addDays(b.billDate, Number(param(actor.companyId, 'fin.ap.default_credit_days') ?? 30));
    if (due < b.billDate) throw badRequest('Correct the highlighted fields', [{ field: 'dueDate', message: 'The due date is on or after the bill date.' }]);
    const tds = b.tdsNature ? tdsFor(actor.companyId, { partnerId: p.id, nature: b.tdsNature, date: b.billDate, basePaise: gross }) : null;
    return { p, gross, gst, due, tds };
  }

  const bills = {
    flow: directFlow,
    list(actor, query) { need(actor, 'fin.bill.view', 'see AP bills'); return runList(db, apList, parseListRequest(apList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => billView(actor, r) }); },
    get(actor, id) { need(actor, 'fin.bill.view', 'see AP bills'); return billView(actor, billRow(actor, id), true); },
    /** What the TDS of a payment would be (the form's live preview; the same as at save and submit). */
    tdsPreview(actor, q) { need(actor, 'fin.bill.view', 'see TDS'); return (({ cumulative, thresholdSingle, thresholdAnnual, ...t }) => ({ ...t, base: rs(t.base), amount: rs(t.amount), cumulative: rs(cumulative ?? 0), thresholdSingle: rs(thresholdSingle ?? 0), thresholdAnnual: rs(thresholdAnnual ?? 0) }))(tdsFor(actor.companyId, { partnerId: Number(q.partnerId), nature: q.nature, date: q.date ?? todayIST(), basePaise: paise(q.amount ?? 0) })); },
    createDirect(actor, b) {
      need(actor, 'fin.bill.create', 'make AP bills'); const v = directValues(actor, b);
      if (b.total != null && paise(b.total) !== v.gross + v.gst) throw badRequest('Correct the highlighted fields', [{ field: 'total', message: 'The total sent does not match the amount and the GST.' }]);
      return transaction(db, () => { const r = insertBill(actor.companyId, { source: 'DIRECT', projectId: b.projectId, siteId: b.siteId, partnerId: v.p.id, payee: v.p.legal_name, billNo: b.billNo, billDate: b.billDate, dueDate: v.due, creditDays: b.creditDays ?? null, description: b.description, expenseAccountId: b.expenseAccountId, gross: v.gross, gst: v.gst, total: v.gross + v.gst, tds: v.tds, status: 'DRAFT', user: actor.user }); audit(actor, 'ap_bills', r.id, 'create', actor.companyId, { newValues: { total: rs(r.total_paise), tds: rs(r.tds_paise) } }); return bills.get(actor, r.id); });
    },
    updateDirect(actor, id, b) {
      const r = directFlow.row(actor, id, 'fin.bill.edit'); if (r.bill_source !== 'DIRECT') throw unprocessable('Only a direct expense bill is changed here; the others follow their source document.'); if (!directFlow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned bill is changed.'); if (b.version !== r.version) throw conflict('The bill was changed by someone else; reload it.');
      const v = directValues(actor, { ...b, partnerId: b.partnerId ?? r.partner_id }); const m = msmeOf(actor.companyId, v.p, b.billDate, b.creditDays ?? null);
      db.prepare('UPDATE ap_bills SET partner_id = ?, payee_name = ?, org_project_id = ?, org_site_id = ?, bill_no = ?, bill_date = ?, due_date = ?, msme = ?, msme_due_date = ?, description = ?, expense_account_id = ?, gross_paise = ?, gst_input_paise = ?, total_paise = ?, tds_nature = ?, tds_section = ?, tds_act = ?, tds_rate = ?, tds_base_paise = ?, tds_paise = ?, tds_payment_code = ?, tds_certificate = ?, tds_basis = ?, ldc_no = ?, net_payable_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(v.p.id, v.p.legal_name, b.projectId ?? null, b.siteId ?? null, b.billNo ?? null, b.billDate, v.due, m.msme, m.msmeDue, b.description ?? null, b.expenseAccountId, v.gross, v.gst, v.gross + v.gst, v.tds?.nature ?? null, v.tds?.section ?? null, v.tds?.act ?? null, v.tds?.rate ?? 0, v.tds?.base ?? 0, v.tds?.amount ?? 0, v.tds?.paymentCode ?? null, v.tds?.certificate ?? null, v.tds?.basis ?? null, v.tds?.ldcNo ?? null, v.gross + v.gst - (v.tds?.amount ?? 0), actor.user, nowIso(), r.id);
      audit(actor, 'ap_bills', r.id, 'update', actor.companyId); return bills.get(actor, r.id);
    },
    remove(actor, id) { const r = billRow(actor, id); if (r.bill_source !== 'DIRECT') throw unprocessable('Only a direct expense bill is deleted here.'); return directFlow.remove(actor, id); },
    submit(actor, id) { const r = billRow(actor, id); if (r.bill_source !== 'DIRECT') throw unprocessable('Only a direct expense bill is sent for approval; the others were approved with their source.'); directFlow.submit(actor, id); return bills.get(actor, id); },
    withdraw(actor, id, b) { directFlow.withdraw(actor, id, b); return bills.get(actor, id); },
    cancel(actor, id, b) { directFlow.cancel(actor, id, b); return bills.get(actor, id); },
    history(actor, id) { return directFlow.history(actor, id); },
    /** FR-05: hold a bill (a dispute) or release it; a held bill is not offered for payment (BR-02). */
    hold(actor, id, { hold, reason }) {
      need(actor, 'fin.bill.hold', 'hold bills'); const r = billRow(actor, id); if (r.status !== 'APPROVED') throw unprocessable('Only an approved bill is held or released.');
      db.prepare('UPDATE ap_bills SET hold_reason = ?, hold_by = ?, hold_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(hold ? reason : null, hold ? actor.user : null, hold ? nowIso() : null, actor.user, nowIso(), r.id);
      audit(actor, 'ap_bills', r.id, hold ? 'hold' : 'release', actor.companyId, { reason, oldValues: { hold: r.hold_reason }, newValues: { hold: hold ? reason : null } });
      publishEvent(db, { type: 'fin.ap_bill.hold_changed', entity: 'ap_bills', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { billId: r.id, docNo: r.doc_no, hold: Boolean(hold), reason } });
      return bills.get(actor, r.id);
    },
    /** FR-04: an advance given to the partner set against the bill (Dr payable, Cr advances). */
    adjustAdvance(actor, id, { advanceId, amount }) {
      need(actor, 'fin.bill.approve', 'set advances against bills'); const r = billRow(actor, id); if (r.status !== 'APPROVED') throw unprocessable('Only an approved bill takes an advance.');
      const a = db.prepare("SELECT * FROM bill_advances WHERE id = ? AND company_id = ? AND direction = 'GIVEN' AND status = 'APPROVED' AND deleted_at IS NULL").get(Number(advanceId), actor.companyId);
      if (!a || a.party_id !== r.partner_id) throw badRequest('Correct the highlighted fields', [{ field: 'advanceId', message: 'Choose an advance given to this partner.' }]);
      const used = db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM ap_bill_adjustments WHERE company_id = ? AND adj_kind = 'ADVANCE' AND ref_id = ? AND deleted_at IS NULL").get(actor.companyId, a.id).s; const avail = a.amount_paise - a.recovered_paise - used; const amt = paise(amount);
      if (amt <= 0 || amt > avail) throw badRequest('Correct the highlighted fields', [{ field: 'amount', message: `At most ₹${(avail / 100).toFixed(2)} of this advance is left.` }]);
      if (amt > outstanding(r)) throw badRequest('Correct the highlighted fields', [{ field: 'amount', message: `The bill has ₹${(outstanding(r) / 100).toFixed(2)} outstanding.` }]);
      return transaction(db, () => {
        const adj = Number(db.prepare("INSERT INTO ap_bill_adjustments (company_id, bill_id, adj_kind, ref_id, amount_paise, adjusted_on, created_by, source_type) VALUES (?, ?, 'ADVANCE', ?, ?, ?, ?, 'ap_bills')").run(actor.companyId, r.id, a.id, amt, todayIST(), actor.user).lastInsertRowid);
        const p = partnerOf(r.company_id, r.partner_id); const proj = a.org_project_id ?? r.org_project_id;
        const j = gl.postEngine(r.company_id, { voucherType: 'JV', date: todayIST(), narration: `Advance ${a.doc_no} set against ${r.doc_no} ${r.payee_name}`, sourceType: 'ap_bill_adjustments', sourceId: adj, lines: [{ accountId: apAccount(r.company_id, p), debit: rs(amt), partnerId: r.partner_id, ...(proj ? { projectId: proj } : {}) }, { accountId: acct(r.company_id, '160001'), credit: rs(amt), partnerId: r.partner_id, ...(proj ? { projectId: proj } : {}) }], user: actor.user });
        db.prepare('UPDATE ap_bill_adjustments SET journal_id = ? WHERE id = ?').run(j.journal.id, adj);
        db.prepare('UPDATE ap_bills SET adjusted_paise = adjusted_paise + ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(amt, actor.user, nowIso(), r.id);
        audit(actor, 'ap_bills', r.id, 'adjust', actor.companyId, { newValues: { advance: a.doc_no, amount: rs(amt) } });
        publishEvent(db, { type: 'fin.advance.adjusted', entity: 'bill_advances', entityId: a.id, actorId: actor.user, companyId: r.company_id, data: { advanceId: a.id, advanceNo: a.doc_no, billId: r.id, billNo: r.doc_no, partnerId: r.partner_id, amount: rs(amt), on: todayIST() } });
        return bills.get(actor, r.id);
      });
    },
    /** BR-02: the bills that can be offered for payment (23.04): approved, something outstanding, nothing holding them. */
    payable(actor, /** @type {{ dueBy?: string }} */ { dueBy } = {}) { need(actor, 'fin.bill.view', 'see payable bills'); return db.prepare("SELECT * FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND net_payable_paise - adjusted_paise - paid_paise > 0 AND due_date <= ? ORDER BY COALESCE(msme_due_date, due_date), due_date").all(actor.companyId, dueBy ?? '9999-12-31').filter((b) => holdsOf(b).length === 0).map((b) => billView(actor, b)); },
    exportCsv(actor, query = {}) { need(actor, 'fin.bill.export', 'export AP bills'); const l = bills.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'ap_bills', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `ap-bills-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['AP bill', 'Payee', 'Their bill', 'From', 'Bill date', 'Due', 'MSME due', 'Amount', 'TDS', 'Outstanding', 'Hold', 'Status'], l.data.map((x) => [x.docNo, x.payee, x.billNo ?? '', x.sourceLabel, x.billDate, x.dueDate, x.msmeDue ?? '', x.total, x.tds, x.outstanding, x.onHold ? 'On hold' : '', x.statusLabel]))}`, 'utf8') }; },
    print(actor, id) { need(actor, 'fin.bill.print', 'print AP bills'); const v = bills.get(actor, id); audit(actor, 'ap_bills', v.id, 'print', actor.companyId); const rows = [['Payee', v.payee], ['Their bill', `${v.billNo ?? ''} of ${v.billDate}`], ['From', `${v.sourceLabel} ${v.sourceRef ?? ''}`], ['Amount', v.gross], ['GST input', v.gst], ['Total', v.total], ['TDS', `${v.tds} (${v.tdsSection ?? 'none'} ${v.tdsRate ? `@ ${v.tdsRate}%` : ''} ${v.tdsBasis ?? ''})`], ['Net payable', v.netPayable], ['Set against it', v.adjusted], ['Paid', v.paid], ['Outstanding', v.outstanding], ['Due', `${v.dueDate}${v.msmeDue ? ` (MSME ${v.msmeDue})` : ''}`], ['Holds', v.holds.map((h) => h.reason).join('; ') || 'none']].map(([k, val]) => ({ k, v: String(val ?? '') })); return { buffer: toPdf({ columns: [{ key: 'k', label: 'Item', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows, footer: [`${v.docNo} · ${v.statusLabel}`], title: `AP bill ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf` }; },
    decide(instance, actor, outcome, comment) { return directFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-03: debit notes and vendors' credit notes (approved by the accounts manager, posted) ----
  const DEFAULT_CREDIT = { RTV: '240002', RATE_DIFFERENCE: '240002', SHORT_SUPPLY: '240002', BACK_CHARGE: '560004', PENALTY: '560004', OTHER: '560004' };
  const dnFlow = createFlow({
    db, base, docType: AP_DN_DOC, table: 'ap_debit_notes', perm: 'fin.debit_note', label: 'debit note', route: '/finance/debit-notes?id=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: null }), ctx: (r) => ({ total: rs(r.total_paise), reason: r.reason }), title: (r) => `${DN_REASONS[r.reason]} ₹${(r.total_paise / 100).toFixed(2)}`, notifyCode: 'fin.debit_note.decided', numberKey: 'FIN_DEBIT_NOTE', prefix: 'DN',
    onApproved: (actor, r) => {
      const n = db.prepare('SELECT * FROM ap_debit_notes WHERE id = ?').get(r.id); const p = partnerOf(n.company_id, n.partner_id); const dims = n.org_project_id ? { projectId: n.org_project_id } : {};
      const credit = n.credit_account_id ?? acct(n.company_id, DEFAULT_CREDIT[n.reason]);
      const lines = [{ accountId: apAccount(n.company_id, p), debit: rs(n.total_paise), partnerId: n.partner_id, ...dims }, { accountId: credit, credit: rs(n.amount_paise), ...dims }, ...gstLines(n.company_id, p, n.gst_paise, 'CR')];
      const j = gl.postEngine(n.company_id, { voucherType: 'DN', date: n.note_date, narration: `${n.note_kind === 'VENDOR_CREDIT' ? 'Credit note from' : 'Debit note to'} ${p?.legal_name ?? ''}: ${DN_REASONS[n.reason]} ${n.description}`.slice(0, 500), sourceType: 'ap_debit_notes', sourceId: n.id, lines, user: actor.user });
      db.prepare('UPDATE ap_debit_notes SET journal_id = ? WHERE id = ?').run(j.journal.id, n.id);
      if (n.bill_id) { const b = db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(n.bill_id); const amt = Math.min(n.total_paise, outstanding(b)); if (amt > 0) { db.prepare("INSERT INTO ap_bill_adjustments (company_id, bill_id, adj_kind, ref_id, amount_paise, adjusted_on, journal_id, created_by, source_type) VALUES (?, ?, 'DEBIT_NOTE', ?, ?, ?, ?, ?, 'ap_debit_notes')").run(n.company_id, b.id, n.id, amt, n.note_date, j.journal.id, actor.user); db.prepare('UPDATE ap_bills SET adjusted_paise = adjusted_paise + ?, version = version + 1 WHERE id = ?').run(amt, b.id); } }
      publishEvent(db, { type: 'fin.debit_note.approved', entity: 'ap_debit_notes', entityId: n.id, actorId: actor.user, companyId: n.company_id, data: { noteId: n.id, docNo: n.doc_no, kind: n.note_kind, partnerId: n.partner_id, reason: n.reason, referenceType: n.reference_type, referenceId: n.reference_id, billId: n.bill_id, amount: rs(n.amount_paise), gst: rs(n.gst_paise), total: rs(n.total_paise) } });
    },
  });
  const dnView = (actor, n, detail = false) => { const p = partnerOf(n.company_id, n.partner_id); const o = { id: n.id, docNo: n.doc_no, kind: n.note_kind, partnerId: n.partner_id, partner: p?.legal_name ?? null, projectId: n.org_project_id, referenceType: n.reference_type, referenceId: n.reference_id, billId: n.bill_id, reason: n.reason, reasonLabel: DN_REASONS[n.reason], noteDate: n.note_date, vendorNoteNo: n.vendor_note_no, description: n.description, amount: rs(n.amount_paise), gst: rs(n.gst_paise), total: rs(n.total_paise), creditAccountId: n.credit_account_id, journalId: n.journal_id, status: n.status, statusLabel: STATUS[n.status], version: n.version, can: dnFlow.can(actor, n) }; if (detail) Object.assign(o, dnFlow.approveInfo(actor, n)); return o; };
  const dnRow = (actor, id) => { const n = db.prepare('SELECT * FROM ap_debit_notes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!n) throw notFound('That debit note does not exist.'); return n; };
  function dnValues(actor, b) {
    const p = partnerOf(actor.companyId, b.partnerId); const problems = [];
    if (!p) problems.push({ field: 'partnerId', message: 'Choose the vendor.' });
    if (b.billId) { const bill = db.prepare("SELECT * FROM ap_bills WHERE id = ? AND company_id = ? AND status = 'APPROVED'").get(Number(b.billId), actor.companyId); if (!bill || bill.partner_id !== Number(b.partnerId)) problems.push({ field: 'billId', message: 'Choose an approved bill of this vendor.' }); }
    if (b.creditAccountId && !db.prepare("SELECT 1 FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND account_status = 'ACTIVE'").get(Number(b.creditAccountId), actor.companyId)) problems.push({ field: 'creditAccountId', message: 'The account does not exist.' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    return { p, amount: paise(b.amount), gst: paise(b.gst ?? 0) };
  }
  const notes = {
    flow: dnFlow,
    list(actor, query) { need(actor, 'fin.debit_note.view', 'see debit notes'); return runList(db, dnList, parseListRequest(dnList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (n) => dnView(actor, n) }); },
    get(actor, id) { need(actor, 'fin.debit_note.view', 'see debit notes'); return dnView(actor, dnRow(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.debit_note.create', 'make debit notes'); const v = dnValues(actor, b);
      const id = Number(db.prepare("INSERT INTO ap_debit_notes (company_id, doc_no, note_kind, partner_id, org_project_id, reference_type, reference_id, bill_id, reason, note_date, vendor_note_no, description, amount_paise, gst_paise, total_paise, credit_account_id, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'ap_debit_notes')")
        .run(actor.companyId, docNo(actor.companyId, 'ap_debit_notes', 'DN'), b.kind ?? 'DEBIT', v.p.id, b.projectId ?? null, b.referenceType ?? (b.billId ? 'AP_BILL' : null), b.referenceId ?? (b.billId ? String(b.billId) : null), b.billId ?? null, b.reason, b.noteDate, b.vendorNoteNo ?? null, b.description, v.amount, v.gst, v.amount + v.gst, b.creditAccountId ?? null, actor.user, actor.user).lastInsertRowid);
      audit(actor, 'ap_debit_notes', id, 'create', actor.companyId, { newValues: { reason: b.reason, total: rs(v.amount + v.gst) } }); return notes.get(actor, id);
    },
    update(actor, id, b) {
      const n = dnFlow.row(actor, id, 'fin.debit_note.edit'); if (!dnFlow.EDITABLE.includes(n.status)) throw conflict('Only a draft or a returned note is changed.'); if (b.version !== n.version) throw conflict('The note was changed by someone else; reload it.');
      const v = dnValues(actor, { ...b, partnerId: b.partnerId ?? n.partner_id });
      db.prepare('UPDATE ap_debit_notes SET partner_id = ?, org_project_id = ?, bill_id = ?, reason = ?, note_date = ?, vendor_note_no = ?, description = ?, amount_paise = ?, gst_paise = ?, total_paise = ?, credit_account_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.p.id, b.projectId ?? null, b.billId ?? null, b.reason, b.noteDate, b.vendorNoteNo ?? null, b.description, v.amount, v.gst, v.amount + v.gst, b.creditAccountId ?? null, actor.user, nowIso(), n.id);
      audit(actor, 'ap_debit_notes', n.id, 'update', actor.companyId); return notes.get(actor, n.id);
    },
    remove(actor, id) { return dnFlow.remove(actor, id); },
    submit(actor, id) { dnFlow.submit(actor, id); return notes.get(actor, id); },
    withdraw(actor, id, b) { dnFlow.withdraw(actor, id, b); return notes.get(actor, id); },
    cancel(actor, id, b) { dnFlow.cancel(actor, id, b); return notes.get(actor, id); },
    history(actor, id) { return dnFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return dnFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-06: the vendor ledger and statement, the ageing, the MSME due report, the TDS deducted ----
  function vendorLedger(actor, { partnerId, from, to }) {
    need(actor, 'fin.bill.view', 'see the vendor ledger'); const p = partnerOf(actor.companyId, partnerId); if (!p) throw notFound('That partner does not exist.');
    const upTo = to ?? todayIST(); const start = from ?? '0000-01-01'; const c = actor.companyId;
    const entries = [
      ...db.prepare("SELECT id, doc_no, bill_no, bill_date AS d, total_paise, tds_paise FROM ap_bills WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND bill_date <= ?").all(c, p.id, upTo).flatMap((b) => [{ d: b.d, kind: 'BILL', ref: b.doc_no, theirRef: b.bill_no, credit: b.total_paise, debit: 0, link: `/finance/ap-bills?id=${b.id}` }, ...(b.tds_paise ? [{ d: b.d, kind: 'TDS', ref: b.doc_no, credit: 0, debit: b.tds_paise, link: `/finance/ap-bills?id=${b.id}` }] : [])]),
      ...db.prepare("SELECT id, doc_no, note_date AS d, total_paise, reason FROM ap_debit_notes WHERE company_id = ? AND partner_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND note_date <= ?").all(c, p.id, upTo).map((n) => ({ d: n.d, kind: 'DEBIT_NOTE', ref: n.doc_no, theirRef: DN_REASONS[n.reason], credit: 0, debit: n.total_paise, link: `/finance/debit-notes?id=${n.id}` })),
      ...db.prepare("SELECT a.amount_paise, a.adjusted_on AS d, b.doc_no FROM ap_bill_adjustments a JOIN ap_bills b ON b.id = a.bill_id WHERE a.company_id = ? AND b.partner_id = ? AND a.adj_kind = 'ADVANCE' AND a.deleted_at IS NULL AND a.adjusted_on <= ?").all(c, p.id, upTo).map((a) => ({ d: a.d, kind: 'ADVANCE', ref: a.doc_no, credit: 0, debit: a.amount_paise })),
    ].sort((x, y) => x.d.localeCompare(y.d) || x.kind.localeCompare(y.kind));
    let bal = 0; let opening = 0; const rows = [];
    for (const e of entries) { bal += e.credit - e.debit; if (e.d < start) { opening = bal; continue; } rows.push({ ...e, credit: rs(e.credit), debit: rs(e.debit), balance: rs(bal) }); }
    return { partner: { id: p.id, code: p.code, name: p.legal_name, msme: p.msme_category, pan: p.pan ? `${String(p.pan).slice(0, 2)}•••••${String(p.pan).slice(-3)}` : null }, from: from ?? null, to: upTo, opening: rs(opening), closing: rs(bal), rows, paymentsNote: 'Payments are made from payment proposals (part 23.04).' };
  }
  function statementPdf(actor, q, letter = false) {
    const l = vendorLedger(actor, q); audit(actor, 'ap_bills', 0, letter ? 'print' : 'export', actor.companyId, { reason: `${letter ? 'balance confirmation' : 'statement'} ${l.partner.code} ${l.to}` });
    if (letter) {
      const rows = [{ k: 'To', v: l.partner.name }, { k: 'Subject', v: `Confirmation of balance as on ${l.to}` }, { k: 'Balance in our books', v: `₹${(l.closing ?? 0).toFixed(2)} ${l.closing >= 0 ? 'payable to you' : 'receivable from you'}` }, { k: 'Request', v: 'Please confirm this balance, or send your statement of account with the differences, within 15 days of this letter. No reply will be taken as your confirmation.' }];
      return { buffer: toPdf({ columns: [{ key: 'k', label: '', type: 'text' }, { key: 'v', label: '', type: 'text' }], rows, footer: ['Accounts payable'], title: `Balance confirmation — ${l.partner.name}` }), contentType: 'application/pdf', fileName: `balance-confirmation-${l.partner.code}-${l.to}.pdf` };
    }
    return { buffer: toPdf({ columns: [{ key: 'd', label: 'Date', type: 'text' }, { key: 'kind', label: 'Entry', type: 'text' }, { key: 'ref', label: 'Ref', type: 'text' }, { key: 'debit', label: 'Debit', type: 'number' }, { key: 'credit', label: 'Credit', type: 'number' }, { key: 'balance', label: 'Balance', type: 'number' }], rows: [{ d: '', kind: 'Opening', ref: '', debit: null, credit: null, balance: l.opening }, ...l.rows], footer: [`${l.partner.name} · to ${l.to} · closing ₹${(l.closing ?? 0).toFixed(2)}`], title: `Statement of account — ${l.partner.name}` }), contentType: 'application/pdf', fileName: `statement-${l.partner.code}-${l.to}.pdf` };
  }
  function ageing(actor, { asOf }) {
    need(actor, 'fin.bill.view', 'see the ageing'); const on2 = asOf ?? todayIST();
    const by = new Map(); const tot = { b0: 0, b31: 0, b61: 0, b91: 0, total: 0 };
    for (const b of db.prepare("SELECT * FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND bill_date <= ? AND net_payable_paise - adjusted_paise - paid_paise > 0").all(actor.companyId, on2)) {
      const o = outstanding(b); const days = daysBetween(b.bill_date, on2); const k = days <= 30 ? 'b0' : days <= 60 ? 'b31' : days <= 90 ? 'b61' : 'b91';
      const key = b.partner_id ? `p${b.partner_id}` : `e${b.employee_id}`; const r = by.get(key) ?? { partnerId: b.partner_id, payee: b.payee_name, b0: 0, b31: 0, b61: 0, b91: 0, total: 0, bills: 0, overdue: 0 };
      r[k] += o; r.total += o; r.bills += 1; if (b.due_date < on2) r.overdue += o; by.set(key, r); tot[k] += o; tot.total += o;
    }
    const rows = [...by.values()].sort((a, b) => b.total - a.total).map((r) => ({ ...r, b0: rs(r.b0), b31: rs(r.b31), b61: rs(r.b61), b91: rs(r.b91), total: rs(r.total), overdue: rs(r.overdue) }));
    return { asOf: on2, rows, totals: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, rs(v)])) };
  }
  function msmeReport(actor, { asOf }) {
    need(actor, 'fin.bill.view', 'see the MSME report'); const on2 = asOf ?? todayIST();
    const rows = db.prepare("SELECT * FROM ap_bills WHERE company_id = ? AND status = 'APPROVED' AND msme = 1 AND deleted_at IS NULL AND net_payable_paise - adjusted_paise - paid_paise > 0 ORDER BY msme_due_date").all(actor.companyId).map((b) => { const left = daysBetween(on2, b.msme_due_date); return { id: b.id, docNo: b.doc_no, payee: b.payee_name, billDate: b.bill_date, msmeDue: b.msme_due_date, daysLeft: left, state: left < 0 ? 'OVERDUE' : left <= 7 ? 'DUE_SOON' : 'OK', outstanding: rs(outstanding(b)), onHold: holdsOf(b).length > 0 }; });
    return { asOf: on2, rows, overdue: rs(rows.filter((r) => r.state === 'OVERDUE').reduce((a, r) => a + paise(r.outstanding), 0)), dueSoon: rs(rows.filter((r) => r.state === 'DUE_SOON').reduce((a, r) => a + paise(r.outstanding), 0)) };
  }
  const quarterOf = (d) => { const m = Number(d.slice(5, 7)); return m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4'; };
  function tdsReport(actor, { from, to }) {
    need(actor, 'fin.bill.view', 'see the TDS deducted'); const f = from ?? '0000-01-01'; const t = to ?? todayIST();
    const rows = db.prepare("SELECT b.*, p.code AS pcode, p.pan FROM ap_bills b LEFT JOIN mdm_partners p ON p.id = b.partner_id WHERE b.company_id = ? AND b.status = 'APPROVED' AND b.tds_paise > 0 AND b.bill_date BETWEEN ? AND ? AND b.deleted_at IS NULL ORDER BY b.bill_date").all(actor.companyId, f, t)
      .map((b) => ({ id: b.id, docNo: b.doc_no, billDate: b.bill_date, quarter: quarterOf(b.bill_date), payee: b.payee_name, partnerCode: b.pcode, pan: b.pan ? `${String(b.pan).slice(0, 2)}•••••${String(b.pan).slice(-3)}` : 'No PAN', section: b.tds_section, act: b.tds_act, nature: b.tds_nature, rate: b.tds_rate / 10000, base: rs(b.tds_base_paise), tds: rs(b.tds_paise), basis: b.tds_basis, paymentCode: b.tds_payment_code, certificate: b.tds_certificate, ldcNo: b.ldc_no }));
    const bySection = {}; for (const r of rows) { const k = `${r.section} ${r.nature}`; bySection[k] ??= { section: r.section, nature: r.nature, act: r.act, base: 0, tds: 0, count: 0 }; bySection[k].base += paise(r.base); bySection[k].tds += paise(r.tds); bySection[k].count += 1; }
    return { from: f, to: t, rows, bySection: Object.values(bySection).map((s) => ({ ...s, base: rs(s.base), tds: rs(s.tds) })), total: rs(rows.reduce((a, r) => a + paise(r.tds), 0)) };
  }
  function reportCsv(actor, kind, q) {
    need(actor, 'fin.bill.export', 'export payables reports'); let headers; let rows;
    if (kind === 'ageing') { const a = ageing(actor, q); headers = ['Payee', 'Bills', '0-30', '31-60', '61-90', '90+', 'Total', 'Overdue']; rows = a.rows.map((r) => [r.payee, r.bills, r.b0, r.b31, r.b61, r.b91, r.total, r.overdue]); }
    else if (kind === 'msme') { const m = msmeReport(actor, q); headers = ['AP bill', 'Payee', 'Bill date', 'MSME due', 'Days left', 'State', 'Outstanding']; rows = m.rows.map((r) => [r.docNo, r.payee, r.billDate, r.msmeDue, r.daysLeft, r.state, r.outstanding]); }
    else { const t = tdsReport(actor, q); headers = ['AP bill', 'Date', 'Quarter', 'Payee', 'PAN', 'Section', 'Act', 'Rate %', 'Base', 'TDS', 'Payment code', 'Certificate']; rows = t.rows.map((r) => [r.docNo, r.billDate, r.quarter, r.payee, r.pan, r.section, r.act, r.rate, r.base, r.tds, r.paymentCode ?? '', r.certificate ?? '']); }
    audit(actor, 'ap_bills', 0, 'export', actor.companyId, { reason: `${kind} ${rows.length} row(s)` });
    return { contentType: 'text/csv; charset=utf-8', fileName: `${kind}-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') };
  }
  const partners = (actor) => { need(actor, 'fin.bill.view', 'see payees'); return db.prepare("SELECT DISTINCT p.id, p.code, p.legal_name AS name, p.msme_category AS msme FROM mdm_partners p WHERE p.company_id = ? AND p.deleted_at IS NULL AND (EXISTS (SELECT 1 FROM ap_bills b WHERE b.partner_id = p.id) OR EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role IN ('VENDOR', 'SUBCONTRACTOR', 'SERVICE_PROVIDER', 'LABOUR_CONTRACTOR', 'TRANSPORTER') AND r.deleted_at IS NULL)) ORDER BY p.legal_name LIMIT 2000").all(actor.companyId); };

  return { consumers, bills, notes, tdsFor, holdsOf, vendorLedger, statementPdf, ageing, msmeReport, tdsReport, reportCsv, partners };
}
