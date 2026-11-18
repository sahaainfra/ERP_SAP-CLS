import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { createStatutoryService } from '../mdm/statutory.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.08: GST reconciliation, ITC review and TDS compliance.
//  - FR-01 GSTR-2B imported (the GSTN JSON, a CSV/Excel export, or the GSP) and matched to the purchase register — the AP bills of 23.03 with GST — by supplier GSTIN,
//    invoice number (case, separators and leading zeros ignored), date and amount: matched; mismatch of amount, date or number (a number that differs a little with the
//    same amount and date); missing in the books; and, from the books' side, missing in 2B. A tax that differs only because the supplier charged the old or the new
//    rate across a rate change (22-09-2025) by its time of supply is matched, with a note — not a false mismatch.
//  - FR-02 each mismatch has an owner, follow-ups with the vendor (e-mail, the vendor portal of 25.02 by its event, a call) and a resolution.
//  - FR-03 the ITC review of a month: eligible (in 2B, matched, ITC available), blocked under s.17(5) (by the expense head), held (not in 2B or a mismatch),
//    reversed for a vendor unpaid beyond 180 days, or claimed by the reviewer's override with its reason (BR-01); approved by the accounts manager and the CFO; the
//    reversal posted to the ledger.
//  - FR-04 GSTR-1 from the sales (tax invoices, other income, credit notes) and the GSTR-3B summary (output, ITC of the approved review, reversals, reverse charge),
//    prepared and marked filed with the ARN; FR-05 TDS: the quarterly statement (26Q for periods to March 2026, Form 140 after, from the forms master of 166.8),
//    challans, the certificates (16A / 131) and the 26AS/AIS match of the TDS clients deducted; FR-06 the compliance calendar (166.8) with each obligation's status.

export const ITC_DOC = 'FIN_ITC_REVIEW';
export const MATCH = { MATCHED: 'Matched', MISMATCH_AMOUNT: 'Amount differs', MISMATCH_DATE: 'Date differs', MISMATCH_NUMBER: 'Number differs', MISSING_IN_BOOKS: 'Missing in the books', MISSING_IN_2B: 'Missing in 2B' };
// D-738: GSTR-3B is due on the 20th of the next month (monthly filer); interest at 18% a year on the tax paid in cash late (s.50(1), on the net cash
// liability); late fee ₹25 a day for CGST and as much for SGST (₹10 each for a nil return), capped at ₹5 000 (₹250 nil) a head for a year's turnover above ₹5 crore (s.47).
const GSTR3B_DUE_DAY = 20; const GST_INTEREST_BP = 1800; const LATE_FEE_PER_HEAD = 2500; const LATE_FEE_NIL_PER_HEAD = 1000; const LATE_FEE_CAP_PER_HEAD = 500000; const LATE_FEE_NIL_CAP_PER_HEAD = 25000;
export const DECISIONS = { ELIGIBLE: 'Eligible', BLOCKED_17_5: 'Blocked (s.17(5))', HELD_NOT_IN_2B: 'Held: not in 2B', HELD_MISMATCH: 'Held: mismatch', REVERSED_UNPAID_180: 'Reversed: unpaid beyond 180 days', INELIGIBLE_2B: 'Not available in 2B', OVERRIDE_CLAIM: 'Claimed by override', RECLAIMED_PAID: 'Re-claimed: the vendor is paid' };
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(lastDay(y, m)).padStart(2, '0')}`; };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** An invoice number as the matcher compares it: capitals, letters and digits only, each run of digits without its leading zeros. */
export const normNo = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/\d+/g, (d) => String(Number(d)));
const lev = (a, b) => { const m = a.length; const n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j += 1) d[0][j] = j; for (let i = 1; i <= m; i += 1) for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
const toIso = (s) => { const t = String(s ?? '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const quarterOf = (date) => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const fy = m >= 4 ? y : y - 1; const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4; return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}-Q${q}`; };
/** D-737: TDS of a quarter is deposited by the 7th of the next month (the last month of Q4 by 30 April); deposits to then belong to its statement. */
const depositDue = (q) => { const fy = Number(q.slice(0, 4)); return [`${fy}-07-07`, `${fy}-10-07`, `${fy + 1}-01-07`, `${fy + 1}-04-30`][Number(q.slice(-1)) - 1]; };
/** D-736: TCS of a quarter is paid by the 7th of the next month, also for March. */
const tcsDue = (q) => { const fy = Number(q.slice(0, 4)); return [`${fy}-07-07`, `${fy}-10-07`, `${fy + 1}-01-07`, `${fy + 1}-04-07`][Number(q.slice(-1)) - 1]; };
const quarterRange = (q) => { const fy = Number(q.slice(0, 4)); const n = Number(q.slice(-1)); const sm = [4, 7, 10, 1][n - 1]; const y = n === 4 ? fy + 1 : fy; const from = `${y}-${String(sm).padStart(2, '0')}-01`; const em = sm + 2; return { from, to: `${y}-${String(em).padStart(2, '0')}-${lastDay(y, em)}` }; };

parameterRegistry.get('fin.itc.blocked_account_codes') || parameterRegistry.define({ key: 'fin.itc.blocked_account_codes', dataType: 'string', default: 'NONE', scopes: ['system', 'company'], description: 'Part 23.08 FR-03: the expense accounts (codes, separated by commas; NONE for none) whose input tax is blocked under s.17(5) of the CGST Act — food and catering, club membership, motor vehicles not used for the business, works contract for own immovable property, personal use.' });
parameterRegistry.get('fin.itc.unpaid_days') || parameterRegistry.define({ key: 'fin.itc.unpaid_days', dataType: 'integer', default: 180, scopes: ['system', 'company'], description: 'Part 23.08 FR-03: input tax of a bill not paid within this many days of the invoice date is reversed (second proviso to s.16(2) of the CGST Act; Rule 37).' });
parameterRegistry.get('fin.gst_recon.amount_tolerance') || parameterRegistry.define({ key: 'fin.gst_recon.amount_tolerance', dataType: 'integer', default: 100, scopes: ['system', 'company'], description: 'Part 23.08 FR-01: the difference in paise up to which the taxable value and the tax of 2B and the books are taken as equal (rounding).' });
parameterRegistry.get('fin.gst_recon.date_days') || parameterRegistry.define({ key: 'fin.gst_recon.date_days', dataType: 'integer', default: 3, scopes: ['system', 'company'], description: 'Part 23.08 FR-01: the days within which an invoice of the same amount with a slightly different number is matched as "number differs".' });

// ---- the 2B file ----
/** GSTR-2B as GSTN's JSON (data.docdata.b2b[].inv[], cdnr[].nt[]) or a CSV with a header (GSTIN, trade name, type, number, date, place of supply, reverse charge, rate, taxable, IGST, CGST, SGST, cess, ITC available). */
export function parse2b(content, format) {
  const lines = [];
  if (format === 'JSON') {
    let j; try { j = JSON.parse(content); } catch { throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'The file is not JSON.' }]); }
    const doc = j?.data?.docdata ?? j?.docdata ?? j; if (!doc || (!doc.b2b && !doc.cdnr)) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'This is not a GSTR-2B file (no b2b or cdnr section).' }]);
    const add = (s, d, type) => { const it = d.items ?? [d]; const sum = (k) => it.reduce((a, x) => a + paise(x[k] ?? 0), 0); const rate = it.length ? Math.round(Number(it[0].rt ?? 0) * 10000) : 0; lines.push({ gstin: s.ctin, name: s.trdnm ?? null, type, no: d.inum ?? d.ntnum, date: toIso(d.dt), pos: d.pos ?? null, rcm: d.rev === 'Y' ? 1 : 0, rate, taxable: sum('txval'), igst: sum('igst'), cgst: sum('cgst'), sgst: sum('sgst'), cess: sum('cess'), itc: d.itcavl === 'N' ? 0 : 1 }); };
    for (const s of doc.b2b ?? []) for (const d of s.inv ?? []) add(s, d, 'INV');
    for (const s of doc.cdnr ?? []) for (const d of s.nt ?? []) add(s, d, d.typ === 'D' ? 'DBN' : 'CRN');
  } else {
    const rows = String(content ?? '').split(/\r?\n/).filter((l) => l.trim()).map((l) => { const out = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; });
    const h = (rows[0] ?? []).map((c) => c.toLowerCase()); const col = (...re) => h.findIndex((c) => re.some((r) => r.test(c)));
    const I = { gstin: col(/gstin/), name: col(/trade|name/), type: col(/type/), no: col(/invoice.*n(o|umber)|note.*n(o|umber)|^number$/), date: col(/date/), pos: col(/place/), rcm: col(/reverse/), rate: col(/rate/), taxable: col(/taxable/), igst: col(/igst|integrated/), cgst: col(/cgst|central/), sgst: col(/sgst|state|ut/), cess: col(/cess/), itc: col(/itc/) };
    if (I.gstin < 0 || I.no < 0 || I.date < 0 || I.taxable < 0) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'The header must name the supplier GSTIN, the invoice number, its date and the taxable value.' }]);
    rows.slice(1).forEach((r) => { const v = (k) => (I[k] >= 0 ? r[I[k]] : ''); const num = (k) => paise(String(v(k) || '0').replace(/[,₹\s]/g, '')); const t = String(v('type')).toUpperCase(); lines.push({ gstin: String(v('gstin')).toUpperCase(), name: v('name') || null, type: /CRED|CRN|^C$/.test(t) ? 'CRN' : /DEB|DBN|^D$/.test(t) ? 'DBN' : 'INV', no: v('no'), date: toIso(v('date')), pos: v('pos') || null, rcm: /^Y/i.test(v('rcm')) ? 1 : 0, rate: Math.round(Number(String(v('rate') || '0').replace('%', '')) * 10000), taxable: num('taxable'), igst: num('igst'), cgst: num('cgst'), sgst: num('sgst'), cess: num('cess'), itc: /^N/i.test(v('itc')) ? 0 : 1 }); });
  }
  const bad = lines.map((l, i) => (!/^[0-9A-Z]{15}$/.test(String(l.gstin ?? '')) || !l.no || !l.date || Number.isNaN(l.taxable) ? `Line ${i + 1}: the GSTIN, number, date or value cannot be read.` : null)).filter(Boolean);
  if (bad.length) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: bad.slice(0, 5).join(' ') }]);
  return lines;
}

/** @param {{ db: any, base: any, gl: any, flags: any, gst?: () => any }} o */
export function createGstReconService({ db, base, gl, flags, gst = () => null }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const statutory = createStatutoryService({ db, flags: null });
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const ownStates = (companyId) => new Set((gst()?.ownGstins(companyId) ?? []).map((g) => g.stateCode));
  const tol = (companyId) => Number(param(companyId, 'fin.gst_recon.amount_tolerance') ?? 100);

  // ---- the purchase register: AP bills with GST, with their supplier's GSTIN ----
  function books(companyId, { from, to }) {
    return db.prepare(`SELECT b.id, b.doc_no, b.bill_no, b.bill_date, b.partner_id, b.payee_name, b.gross_paise, b.gst_input_paise, b.total_paise, b.paid_paise, b.adjusted_paise, b.expense_account_id, b.org_project_id,
        COALESCE(vi.vendor_gstin, (SELECT g.gstin FROM mdm_partner_gstins g WHERE g.partner_id = b.partner_id AND g.gstin_status = 'ACTIVE' AND g.deleted_at IS NULL ORDER BY g.id LIMIT 1)) AS gstin
      FROM ap_bills b LEFT JOIN bill_vendor_invoices vi ON b.bill_source = 'VENDOR_INVOICE' AND vi.id = CAST(b.source_ref AS INTEGER)
      WHERE b.company_id = ? AND b.status = 'APPROVED' AND b.gst_input_paise > 0 AND b.deleted_at IS NULL AND b.bill_date BETWEEN ? AND ? ORDER BY b.bill_date, b.id`).all(companyId, from, to);
  }
  /** Pairs of rates (old, new, in % ×10 000) of HSN/SAC codes whose rate changed within 45 days of a date: a supplier charging either by its time of supply is not a mismatch. */
  function ratePairs(date) {
    const rows = db.prepare(`SELECT h.code, h.effective_from, g.igst_pct AS now_pct, (SELECT g2.igst_pct FROM mdm_hsn_sac h2 JOIN mdm_gst_rates g2 ON g2.code = h2.default_gst_code AND g2.company_id IS NULL AND g2.row_status = 'ACTIVE' WHERE h2.code = h.code AND h2.company_id IS NULL AND h2.row_status = 'ACTIVE' AND h2.effective_from < h.effective_from ORDER BY h2.effective_from DESC LIMIT 1) AS was_pct
      FROM mdm_hsn_sac h JOIN mdm_gst_rates g ON g.code = h.default_gst_code AND g.company_id IS NULL AND g.row_status = 'ACTIVE' WHERE h.company_id IS NULL AND h.row_status = 'ACTIVE' AND h.effective_from BETWEEN ? AND ?`).all(addDays(date, -45), addDays(date, 45));
    return rows.filter((r) => r.was_pct != null && r.was_pct !== r.now_pct).map((r) => ({ a: r.was_pct, b: r.now_pct, on: r.effective_from, code: r.code }));
  }
  const pctOf = (tax, taxable) => (taxable > 0 ? Math.round((tax * 1_000_000) / taxable / 100) * 100 : 0); // ×10 000, to 0.01 %
  const near = (a, b, t) => Math.abs(a - b) <= t;

  /** FR-01: match the 2B lines of a period to the books (a line already resolved by hand keeps its match). */
  function match(companyId, period) {
    const t = tol(companyId); const dd = Number(param(companyId, 'fin.gst_recon.date_days') ?? 3);
    const lines = db.prepare("SELECT * FROM gst_2b_lines WHERE company_id = ? AND period = ? AND deleted_at IS NULL AND resolution_status NOT IN ('RESOLVED', 'ACCEPTED') ORDER BY id").all(companyId, period);
    const taken = new Set(db.prepare("SELECT matched_bill_id AS b FROM gst_2b_lines WHERE company_id = ? AND matched_bill_id IS NOT NULL AND (period <> ? OR resolution_status IN ('RESOLVED', 'ACCEPTED')) AND deleted_at IS NULL").all(companyId, period).map((r) => r.b));
    const pool = books(companyId, { from: addDays(`${period}-01`, -366), to: monthEnd(period) }).filter((b) => !taken.has(b.id)).map((b) => ({ ...b, n: normNo(b.bill_no) }));
    const byGstin = new Map(); for (const b of pool) { if (!b.gstin) continue; const k = b.gstin.toUpperCase(); if (!byGstin.has(k)) byGstin.set(k, []); byGstin.get(k).push(b); }
    const used = new Set(); const counts = { MATCHED: 0, MISMATCH_AMOUNT: 0, MISMATCH_DATE: 0, MISMATCH_NUMBER: 0, MISSING_IN_BOOKS: 0 };
    const set = db.prepare('UPDATE gst_2b_lines SET match_status = ?, matched_bill_id = ?, match_note = ?, books_tax_paise = ?, diff_paise = ?, updated_at = ?, version = version + 1 WHERE id = ?');
    transaction(db, () => {
      for (const l of lines) {
        const cands = (byGstin.get(l.supplier_gstin) ?? []).filter((b) => !used.has(b.id)); const tax = l.igst_paise + l.cgst_paise + l.sgst_paise + l.cess_paise; const n = normNo(l.invoice_no);
        let status = 'MISSING_IN_BOOKS'; let bill = null; let note = null;
        const same = cands.find((b) => b.n === n);
        if (same) {
          bill = same; const taxOk = near(same.gst_input_paise, tax, t); const valOk = near(same.gross_paise, l.taxable_paise, t);
          if (valOk && !taxOk) { const r2b = pctOf(tax, l.taxable_paise); const rb = pctOf(same.gst_input_paise, same.gross_paise); const pair = ratePairs(l.invoice_date).find((p) => (near(p.a, r2b, 100) && near(p.b, rb, 100)) || (near(p.b, r2b, 100) && near(p.a, rb, 100))); if (pair) note = `Rate change of ${pair.code} on ${pair.on}: ${r2b / 10000}% in 2B, ${rb / 10000}% in the books — the supplier's rate by the time of supply; the ITC is the tax in 2B.`; }
          status = (valOk && (taxOk || note)) ? (l.invoice_date === same.bill_date ? 'MATCHED' : 'MISMATCH_DATE') : 'MISMATCH_AMOUNT';
          if (status === 'MISMATCH_AMOUNT') note = `Books: taxable ₹${rs(same.gross_paise)}, GST ₹${rs(same.gst_input_paise)}; 2B: taxable ₹${rs(l.taxable_paise)}, GST ₹${rs(tax)}.`;
          if (status === 'MISMATCH_DATE') note = `${note ? `${note} ` : ''}Books: ${same.bill_date}; 2B: ${l.invoice_date}.`;
        } else {
          const fuzzy = cands.find((b) => near(b.gross_paise, l.taxable_paise, t) && near(b.gst_input_paise, tax, t) && Math.abs(daysBetween(b.bill_date, l.invoice_date)) <= dd && (b.n.endsWith(n) || n.endsWith(b.n) || lev(b.n, n) <= 2));
          if (fuzzy) { bill = fuzzy; status = 'MISMATCH_NUMBER'; note = `Books: ${fuzzy.bill_no}; 2B: ${l.invoice_no}.`; }
        }
        if (bill) used.add(bill.id); counts[status] += 1;
        set.run(status, bill?.id ?? null, note, bill?.gst_input_paise ?? null, bill ? tax - bill.gst_input_paise : 0, nowIso(), l.id);
      }
    });
    return counts;
  }

  // ---- the views ----
  const lineView = (actor, l) => { const age = daysBetween(String(l.created_at).slice(0, 10), todayIST()); const b = !l.matched_bill_id ? null : 'b_doc' in l ? { doc_no: l.b_doc, bill_no: l.b_no, bill_date: l.b_date, payee_name: l.b_payee } : db.prepare('SELECT doc_no, bill_no, bill_date, payee_name FROM ap_bills WHERE id = ?').get(l.matched_bill_id);
    return { id: l.id, period: l.period, supplierGstin: l.supplier_gstin, supplier: l.supplier_name ?? b?.payee_name ?? null, type: l.doc_type, invoiceNo: l.invoice_no, invoiceDate: l.invoice_date, taxable: rs(l.taxable_paise), igst: rs(l.igst_paise), cgst: rs(l.cgst_paise), sgst: rs(l.sgst_paise), cess: rs(l.cess_paise), tax: rs(l.igst_paise + l.cgst_paise + l.sgst_paise + l.cess_paise), rate: l.rate_pct / 10000, itcAvailable: Boolean(l.itc_available), reverseCharge: Boolean(l.reverse_charge),
      status: l.match_status, statusLabel: MATCH[l.match_status], note: l.match_note, bill: b ? { id: l.matched_bill_id, docNo: b.doc_no, billNo: b.bill_no, date: b.bill_date } : null, booksTax: rs(l.books_tax_paise), diff: rs(l.diff_paise), owner: l.owner, resolution: l.resolution_status, resolutionNote: l.resolution_note, followups: l.followups_count, nextFollowup: l.next_followup, ageDays: age, sla: l.match_status === 'MATCHED' || ['RESOLVED', 'ACCEPTED'].includes(l.resolution_status) ? 'DONE' : age > 10 ? 'LATE' : age > 5 ? 'DUE' : 'OK',
      can: { manage: l.match_status !== 'MATCHED' && may(actor, 'fin.gst_recon.manage') } }; };

  const recon = {
    import(actor, b) {
      need(actor, 'fin.gst_recon.import', 'import GSTR-2B'); const c = actor.companyId;
      let lines; if (b.format === 'GSP') { const s = gst()?.settingsOn(c); if (!s?.gsp_connector_code) throw unprocessable('No GSP connector is set in the GST settings: import the 2B file instead.'); throw unprocessable('The GSP does not offer GSTR-2B through this connector yet (D-735): download the 2B JSON from the portal and import it.'); }
      lines = parse2b(b.content, b.format);
      const gstin = (b.gstin ?? gst()?.ownGstins(c)?.[0]?.gstin ?? '').toUpperCase(); if (!gstin) throw unprocessable('The company has no GSTIN (Company settings).');
      return transaction(db, () => {
        const imp = Number(db.prepare('INSERT INTO gst_2b_imports (company_id, doc_no, period, gstin, file_name, file_format, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c, docNo(c, 'gst_2b_imports', '2B'), b.period, gstin, b.fileName, b.format, actor.user).lastInsertRowid);
        let added = 0; let dup = 0; const ins = db.prepare('INSERT OR IGNORE INTO gst_2b_lines (company_id, import_id, period, line_hash, supplier_gstin, supplier_name, doc_type, invoice_no, invoice_date, pos, reverse_charge, rate_pct, taxable_paise, igst_paise, cgst_paise, sgst_paise, cess_paise, itc_available, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const l of lines) { const h = createHash('sha256').update([gstin, l.gstin, l.type, normNo(l.no), l.date].join('|')).digest('hex'); const r = ins.run(c, imp, b.period, h, l.gstin, l.name, l.type, l.no, l.date, l.pos, l.rcm, l.rate, l.taxable, l.igst, l.cgst, l.sgst, l.cess, l.itc, actor.user, 'gst_2b_imports', String(imp)); if (r.changes) added += 1; else dup += 1; }
        db.prepare('UPDATE gst_2b_imports SET lines_count = ?, duplicates_count = ? WHERE id = ?').run(added, dup, imp); audit(actor, 'gst_2b_imports', imp, 'import', c, { reason: `${added} line(s), ${dup} already imported` });
        const counts = match(c, b.period); evt('fin.gst_2b.imported', actor, c, 'gst_2b_imports', imp, { importId: imp, period: b.period, lines: added, ...counts });
        return { importId: imp, lines: added, duplicates: dup, counts };
      });
    },
    rematch(actor, { period }) { need(actor, 'fin.gst_recon.manage', 'match GSTR-2B'); const counts = match(actor.companyId, period); audit(actor, 'gst_2b_lines', 0, 'rematch', actor.companyId, { reason: period }); return counts; },
    /** The worklist of a period: each category with its lines, and the books missing in 2B. */
    /** @param {any} actor @param {{ period: string, status?: string, mine?: any }} q */
    worklist(actor, { period, status = undefined, mine = undefined }) {
      need(actor, 'fin.gst_recon.view', 'see the GST reconciliation'); const c = actor.companyId; const LIMIT = 500;
      const agg = db.prepare('SELECT match_status AS s, COUNT(*) AS n, SUM(igst_paise + cgst_paise + sgst_paise + cess_paise) AS t FROM gst_2b_lines WHERE company_id = ? AND period = ? AND deleted_at IS NULL GROUP BY match_status').all(c, period);
      const missingWhere = "b.company_id = ? AND b.status = 'APPROVED' AND b.gst_input_paise > 0 AND b.deleted_at IS NULL AND b.bill_date BETWEEN ? AND ? AND b.id NOT IN (SELECT g.matched_bill_id FROM gst_2b_lines g WHERE g.company_id = ? AND g.matched_bill_id IS NOT NULL AND g.deleted_at IS NULL)";
      const missingCount = db.prepare(`SELECT COUNT(*) AS n FROM ap_bills b WHERE ${missingWhere}`).get(c, `${period}-01`, monthEnd(period), c).n;
      const counts = Object.fromEntries(Object.keys(MATCH).map((k) => [k, k === 'MISSING_IN_2B' ? missingCount : agg.find((a) => a.s === k)?.n ?? 0]));
      const wantLines = status !== 'MISSING_IN_2B'; const wantMissing = !status || status === 'MISSING_IN_2B';
      const cond = status === 'MISMATCH' ? " AND l.match_status LIKE 'MISMATCH%'" : status && status !== 'MISSING_IN_2B' ? ' AND l.match_status = ?' : '';
      const args = [c, period, ...(status && !['MISMATCH', 'MISSING_IN_2B'].includes(status) ? [status] : []), ...(mine ? [actor.user] : [])];
      const rows = wantLines ? db.prepare(`SELECT l.*, b.doc_no AS b_doc, b.bill_no AS b_no, b.bill_date AS b_date, b.payee_name AS b_payee FROM gst_2b_lines l LEFT JOIN ap_bills b ON b.id = l.matched_bill_id WHERE l.company_id = ? AND l.period = ? AND l.deleted_at IS NULL${cond}${mine ? ' AND l.owner = ?' : ''} ORDER BY CASE WHEN l.match_status = 'MATCHED' OR l.resolution_status IN ('RESOLVED', 'ACCEPTED') THEN 1 ELSE 0 END, l.created_at, l.id LIMIT ${LIMIT}`).all(...args).map((l) => lineView(actor, l)) : [];
      rows.sort((a, b) => ({ LATE: 0, DUE: 1, OK: 2, DONE: 3 }[a.sla] - { LATE: 0, DUE: 1, OK: 2, DONE: 3 }[b.sla]) || b.ageDays - a.ageDays);
      const missingIn2b = wantMissing ? db.prepare(`SELECT b.id, b.doc_no, b.payee_name, b.bill_no, b.bill_date, b.gross_paise, b.gst_input_paise, (SELECT g.gstin FROM mdm_partner_gstins g WHERE g.partner_id = b.partner_id AND g.gstin_status = 'ACTIVE' AND g.deleted_at IS NULL ORDER BY g.id LIMIT 1) AS gstin, (SELECT COUNT(*) FROM gst_recon_followups f WHERE f.bill_id = b.id AND f.deleted_at IS NULL) AS fu FROM ap_bills b WHERE ${missingWhere} ORDER BY b.bill_date, b.id LIMIT ${LIMIT}`).all(c, `${period}-01`, monthEnd(period), c)
        .map((x) => ({ billId: x.id, docNo: x.doc_no, supplier: x.payee_name, supplierGstin: x.gstin, invoiceNo: x.bill_no, invoiceDate: x.bill_date, taxable: rs(x.gross_paise), tax: rs(x.gst_input_paise), status: 'MISSING_IN_2B', statusLabel: MATCH.MISSING_IN_2B, followups: x.fu })) : [];
      const imports = db.prepare('SELECT doc_no, file_name, lines_count, duplicates_count, created_by, created_at FROM gst_2b_imports WHERE company_id = ? AND period = ? ORDER BY id DESC').all(c, period).map((i) => ({ docNo: i.doc_no, fileName: i.file_name, lines: i.lines_count, duplicates: i.duplicates_count, by: i.created_by, at: i.created_at }));
      return { period, counts, limit: LIMIT, taxIn2b: rs(agg.reduce((a, x) => a + (x.t ?? 0), 0)), taxMatched: rs(agg.find((a) => a.s === 'MATCHED')?.t ?? 0), rows, missingIn2b, imports, canImport: may(actor, 'fin.gst_recon.import'), canManage: may(actor, 'fin.gst_recon.manage') };
    },
    line(actor, id) { need(actor, 'fin.gst_recon.view', 'see the GST reconciliation'); const l = db.prepare('SELECT * FROM gst_2b_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!l) throw notFound('That 2B line does not exist.'); return { ...lineView(actor, l), history: db.prepare('SELECT channel, note, next_date, by_user, created_at FROM gst_recon_followups WHERE line_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(l.id).map((f) => ({ channel: f.channel, note: f.note, nextDate: f.next_date, by: f.by_user, at: f.created_at })) }; },
    /** FR-02: an owner, a follow-up with the vendor (the vendor portal of 25.02 reads the event), a resolution. */
    act(actor, id, b) {
      need(actor, 'fin.gst_recon.manage', 'work on mismatches'); const isBill = b.on === 'bill';
      const l = isBill ? null : db.prepare('SELECT * FROM gst_2b_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
      const bill = isBill ? db.prepare('SELECT * FROM ap_bills WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId) : null; if (!l && !bill) throw notFound('That line does not exist.');
      if (l && b.version != null && b.version !== l.version) throw conflict('Someone changed this line meanwhile: reload it.');
      return transaction(db, () => {
        if (b.action === 'assign') { if (!l) throw unprocessable('Assign a 2B line.'); db.prepare('UPDATE gst_2b_lines SET owner = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.owner ?? actor.user, actor.user, nowIso(), l.id); audit(actor, 'gst_2b_lines', l.id, 'assign', actor.companyId, { oldValues: { owner: l.owner }, newValues: { owner: b.owner ?? actor.user } }); }
        else if (b.action === 'followup') {
          const partner = bill?.partner_id ?? (l?.matched_bill_id ? db.prepare('SELECT partner_id FROM ap_bills WHERE id = ?').get(l.matched_bill_id)?.partner_id : db.prepare('SELECT partner_id FROM mdm_partner_gstins WHERE gstin = ? AND company_id = ? AND deleted_at IS NULL LIMIT 1').get(l.supplier_gstin, actor.companyId)?.partner_id) ?? null;
          db.prepare('INSERT INTO gst_recon_followups (company_id, line_id, bill_id, partner_id, channel, note, next_date, by_user, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, l?.id ?? null, bill?.id ?? null, partner, b.channel, b.note, b.nextDate ?? null, actor.user, actor.user);
          if (l) db.prepare("UPDATE gst_2b_lines SET resolution_status = 'FOLLOW_UP', owner = COALESCE(owner, ?), followups_count = followups_count + 1, next_followup = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, b.nextDate ?? null, nowIso(), l.id);
          evt('fin.gst_recon.followup', actor, actor.companyId, l ? 'gst_2b_lines' : 'ap_bills', l?.id ?? bill.id, { lineId: l?.id ?? null, billId: bill?.id ?? l?.matched_bill_id ?? null, partnerId: partner, channel: b.channel, invoiceNo: l?.invoice_no ?? bill.bill_no, invoiceDate: l?.invoice_date ?? bill.bill_date, issue: l ? MATCH[l.match_status] : MATCH.MISSING_IN_2B, note: b.note, nextDate: b.nextDate ?? null });
          audit(actor, l ? 'gst_2b_lines' : 'ap_bills', l?.id ?? bill.id, 'gst_followup', actor.companyId, { reason: `${b.channel}: ${b.note}` });
        } else if (b.action === 'resolve' || b.action === 'accept') {
          if (!l) throw unprocessable('Resolve a 2B line.'); if (!b.note || b.note.trim().length < 5) throw badRequest('Correct the highlighted fields', [{ field: 'note', message: 'Say how it was resolved (at least 5 characters).' }]);
          db.prepare('UPDATE gst_2b_lines SET resolution_status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.action === 'resolve' ? 'RESOLVED' : 'ACCEPTED', b.note, actor.user, nowIso(), actor.user, nowIso(), l.id); audit(actor, 'gst_2b_lines', l.id, b.action, actor.companyId, { reason: b.note });
        } else if (b.action === 'reopen') { if (!l) throw unprocessable('Reopen a 2B line.'); db.prepare("UPDATE gst_2b_lines SET resolution_status = 'OPEN', resolution_note = NULL, resolved_by = NULL, resolved_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), l.id); audit(actor, 'gst_2b_lines', l.id, 'reopen', actor.companyId); }
        return l ? recon.line(actor, l.id) : { billId: bill.id, followed: true };
      });
    },
    exportCsv(actor, { period }) { need(actor, 'fin.gst_recon.export', 'export the reconciliation'); const w = recon.worklist(actor, { period }); audit(actor, 'gst_2b_lines', 0, 'export', actor.companyId, { reason: period }); const rows = [...w.rows.map((r) => [r.statusLabel, r.supplierGstin, r.supplier ?? '', r.type, r.invoiceNo, r.invoiceDate, r.taxable, r.tax, r.bill?.docNo ?? '', r.booksTax ?? '', r.diff, r.owner ?? '', r.resolution, r.note ?? '']), ...w.missingIn2b.map((m) => [m.statusLabel, m.supplierGstin ?? '', m.supplier, 'INV', m.invoiceNo, m.invoiceDate, m.taxable, '', m.docNo, m.tax, '', '', 'OPEN', ''])]; return { contentType: 'text/csv; charset=utf-8', fileName: `gstr-2b-reconciliation-${period}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Category', 'Supplier GSTIN', 'Supplier', 'Type', 'Invoice', 'Date', 'Taxable', 'GST in 2B', 'AP bill', 'GST in books', 'Difference', 'Owner', 'Resolution', 'Note'], rows)}`, 'utf8') }; },
  };

  // ---- FR-03: the ITC review ----
  const blockedAccounts = (companyId) => { const codes = String(param(companyId, 'fin.itc.blocked_account_codes') ?? '').split(/[,\s]+/).filter(Boolean); return new Set(codes.map((k) => acct(companyId, k)).filter(Boolean)); };
  /** The lines of a month's review: the bills of the month, those held earlier now in 2B, and the bills of any month unpaid beyond the days. */
  function computeLines(companyId, period, overrides = new Map()) {
    const blocked = blockedAccounts(companyId); const unpaidDays = Number(param(companyId, 'fin.itc.unpaid_days') ?? 180); const end = monthEnd(period);
    const lines2b = new Map(db.prepare('SELECT * FROM gst_2b_lines WHERE company_id = ? AND matched_bill_id IS NOT NULL AND deleted_at IS NULL').all(companyId).map((l) => [l.matched_bill_id, l]));
    const claimedBefore = new Set(db.prepare("SELECT l.bill_id FROM gst_itc_review_lines l JOIN gst_itc_reviews r ON r.id = l.review_id WHERE r.company_id = ? AND r.status = 'APPROVED' AND r.period < ? AND l.decision IN ('ELIGIBLE', 'OVERRIDE_CLAIM') AND l.deleted_at IS NULL").all(companyId, period).map((x) => x.bill_id));
    // D-738: what was reversed for a bill and not yet re-claimed (Rule 37(2): claimed again once the vendor is paid)
    // (a re-claim approved in any month counts, so a review of an earlier month made later does not claim it twice)
    const reversedAmt = new Map(); for (const x of db.prepare("SELECT l.bill_id, l.decision, l.reverse_paise, l.claim_paise FROM gst_itc_review_lines l JOIN gst_itc_reviews r ON r.id = l.review_id WHERE r.company_id = ? AND r.status = 'APPROVED' AND (l.decision = 'REVERSED_UNPAID_180' AND r.period < ? OR l.decision = 'RECLAIMED_PAID') AND l.deleted_at IS NULL").all(companyId, period)) reversedAmt.set(x.bill_id, (reversedAmt.get(x.bill_id) ?? 0) + (x.decision === 'REVERSED_UNPAID_180' ? x.reverse_paise : -x.claim_paise));
    const reversedBefore = new Set([...reversedAmt.keys()]);
    const heldBefore = db.prepare("SELECT l.bill_id FROM gst_itc_review_lines l JOIN gst_itc_reviews r ON r.id = l.review_id WHERE r.company_id = ? AND r.status = 'APPROVED' AND r.period < ? AND l.decision IN ('HELD_NOT_IN_2B', 'HELD_MISMATCH') AND l.deleted_at IS NULL").all(companyId, period).map((x) => x.bill_id).filter((b) => !claimedBefore.has(b));
    const everything = books(companyId, { from: '0000-01-01', to: end }); const byId = new Map(everything.map((b) => [b.id, b]));
    const ofMonth = everything.filter((b) => b.bill_date >= `${period}-01`); const ids = new Set(ofMonth.map((b) => b.id));
    const carried = heldBefore.filter((b) => !ids.has(b)).map((id) => byId.get(id)).filter(Boolean);
    const out = [];
    for (const b of [...ofMonth, ...carried]) {
      const l = lines2b.get(b.id); const ov = overrides.get(b.id); let decision; let claim = 0; let reason;
      if (blocked.has(b.expense_account_id)) { decision = 'BLOCKED_17_5'; reason = 'The expense head is in the blocked list (s.17(5)).'; }
      else if (l && !l.itc_available) { decision = 'INELIGIBLE_2B'; reason = 'The supplier reported it with ITC not available.'; }
      else if (l && (l.match_status === 'MATCHED' || ['RESOLVED', 'ACCEPTED'].includes(l.resolution_status))) { decision = 'ELIGIBLE'; claim = Math.min(b.gst_input_paise, l.igst_paise + l.cgst_paise + l.sgst_paise + l.cess_paise); reason = l.match_note; }
      else if (l) { decision = 'HELD_MISMATCH'; reason = `${MATCH[l.match_status]}: ${l.match_note ?? ''}`.trim(); }
      else { decision = 'HELD_NOT_IN_2B'; reason = 'Not in GSTR-2B: ITC only for invoices reported by the supplier (s.16(2)(aa)).'; }
      // BR-01: a reviewer may claim a held invoice with a reason; never a blocked one
      if (ov && ['HELD_MISMATCH', 'HELD_NOT_IN_2B'].includes(decision)) { decision = 'OVERRIDE_CLAIM'; claim = b.gst_input_paise; reason = ov; }
      out.push({ bill: b, line2b: l ?? null, decision, claim, reverse: 0, reason, tax: b.gst_input_paise });
    }
    // reversal: bills of any month claimed earlier (or now), unpaid beyond the days at the end of the month
    const cutoff = addDays(end, -unpaidDays); const old = everything.filter((b) => b.bill_date <= cutoff); const claimedNow = new Set(out.filter((x) => x.claim > 0).map((x) => x.bill.id));
    for (const b of old) {
      if (reversedBefore.has(b.id) || !(claimedBefore.has(b.id) || claimedNow.has(b.id))) continue;
      const unpaid = b.total_paise - b.paid_paise - b.adjusted_paise; if (unpaid <= 0) continue;
      const rev = Math.round((b.gst_input_paise * unpaid) / b.total_paise);
      out.push({ bill: b, line2b: lines2b.get(b.id) ?? null, decision: 'REVERSED_UNPAID_180', claim: 0, reverse: rev, reason: `Unpaid ₹${rs(unpaid)} of ₹${rs(b.total_paise)} ${daysBetween(b.bill_date, end)} days after the invoice (s.16(2), Rule 37).`, tax: b.gst_input_paise });
    }
    for (const [billId, amt] of reversedAmt) {
      const b = byId.get(billId); if (!b || amt <= 0) continue; const unpaid = b.total_paise - b.paid_paise - b.adjusted_paise; if (unpaid > 0) continue;
      out.push({ bill: b, line2b: lines2b.get(b.id) ?? null, decision: 'RECLAIMED_PAID', claim: amt, reverse: 0, reason: `Paid in full: the ₹${rs(amt)} reversed earlier is claimed again (s.16(2), Rule 37(2)).`, tax: b.gst_input_paise });
    }
    return out;
  }
  const totalsOf = (lines) => { const s = (/** @type {(x: any) => boolean} */ f, k = 'tax') => lines.filter(f).reduce((/** @type {number} */ a, /** @type {any} */ x) => a + Number(x[k]), 0); const eligible = s((x) => x.decision === 'ELIGIBLE', 'claim'); const override = s((x) => x.decision === 'OVERRIDE_CLAIM', 'claim'); const reversed = s((x) => x.decision === 'REVERSED_UNPAID_180', 'reverse'); const reclaimed = s((x) => x.decision === 'RECLAIMED_PAID', 'claim');
    return { eligible, blocked: s((x) => ['BLOCKED_17_5', 'INELIGIBLE_2B'].includes(x.decision)), held: s((x) => ['HELD_NOT_IN_2B', 'HELD_MISMATCH'].includes(x.decision)), reversed, override, reclaimed, claimable: Math.max(0, eligible + override + reclaimed - reversed) }; };
  function writeLines(r, lines) {
    db.prepare('UPDATE gst_itc_review_lines SET deleted_at = ? WHERE review_id = ? AND deleted_at IS NULL').run(nowIso(), r.id);
    const ins = db.prepare('INSERT INTO gst_itc_review_lines (company_id, review_id, bill_id, line_2b_id, supplier_gstin, supplier_name, invoice_no, invoice_date, taxable_paise, tax_paise, decision, reason, claim_paise, reverse_paise, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const x of lines) ins.run(r.company_id, r.id, x.bill.id, x.line2b?.id ?? null, x.bill.gstin ?? null, x.bill.payee_name, x.bill.bill_no, x.bill.bill_date, x.bill.gross_paise, x.tax, x.decision, x.reason, x.claim, x.reverse, 'system');
    const t = totalsOf(lines); db.prepare('UPDATE gst_itc_reviews SET eligible_paise = ?, blocked_paise = ?, held_paise = ?, reversed_paise = ?, override_paise = ?, claimable_paise = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(t.eligible, t.blocked, t.held, t.reversed, t.override, t.claimable, nowIso(), r.id);
  }
  /** The tax of a review's lines of a decision by head: IGST when the supplier is in another state, else half CGST and half SGST. */
  function headsOf(reviewId, decision, col) {
    const r = db.prepare('SELECT company_id FROM gst_itc_reviews WHERE id = ?').get(reviewId); const own = ownStates(r.company_id); const h = { igst: 0, cgst: 0, sgst: 0, total: 0 };
    for (const l of db.prepare(`SELECT supplier_gstin, ${col} AS v FROM gst_itc_review_lines WHERE review_id = ? AND decision ${Array.isArray(decision) ? `IN (${decision.map(() => '?').join(', ')})` : '= ?'} AND deleted_at IS NULL`).all(reviewId, ...[decision].flat())) { if (l.supplier_gstin && own.size && !own.has(l.supplier_gstin.slice(0, 2))) h.igst += l.v; else { const half = Math.round(l.v / 2); h.cgst += half; h.sgst += l.v - half; } h.total += l.v; }
    return h;
  }
  const overridesOf = (reviewId) => new Map(db.prepare("SELECT bill_id, reason FROM gst_itc_review_lines WHERE review_id = ? AND decision = 'OVERRIDE_CLAIM' AND deleted_at IS NULL").all(reviewId).map((x) => [x.bill_id, x.reason]));
  const rolesOf = (companyId, user) => json(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]', []).flat();
  const itcFlow = createFlow({ db, base, docType: ITC_DOC, table: 'gst_itc_reviews', perm: 'fin.itc_review', label: 'ITC review', route: '/finance/gst-reconciliation?tab=itc&review=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.claimable_paise), period: r.period, makerRole: rolesOf(r.company_id, r.requested_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `ITC of ${r.period}: claim ₹${rs(r.claimable_paise)}, reverse ₹${rs(r.reversed_paise)}`, notifyCode: 'fin.itc.decided', prefix: 'ITC',
    beforeSubmit: (_a, r) => { if (r.period > todayIST().slice(0, 7)) throw unprocessable('The month has not ended yet.'); writeLines(r, computeLines(r.company_id, r.period, overridesOf(r.id))); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM gst_itc_reviews WHERE id = ?').get(r.id);
      // the reversal by head (IGST when the supplier is in another state, else half CGST and half SGST); D-738: a re-claim puts it back
      const rev = headsOf(x.id, 'REVERSED_UNPAID_180', 'reverse_paise'); const rec = headsOf(x.id, 'RECLAIMED_PAID', 'claim_paise'); const net = { cgst: rev.cgst - rec.cgst, sgst: rev.sgst - rec.sgst, igst: rev.igst - rec.igst }; const total = net.cgst + net.sgst + net.igst;
      if (rev.total > 0 || rec.total > 0) {
        const lines = [total > 0 ? { accountId: acct(x.company_id, '560011'), debit: rs(total) } : total < 0 ? { accountId: acct(x.company_id, '560011'), credit: rs(-total) } : null, ...[{ code: '170001', v: net.cgst }, { code: '170002', v: net.sgst }, { code: '170003', v: net.igst }].filter((h) => h.v !== 0).map((h) => (h.v > 0 ? { accountId: acct(x.company_id, h.code), credit: rs(h.v) } : { accountId: acct(x.company_id, h.code), debit: rs(-h.v) }))].filter(Boolean);
        if (lines.length > 1) { const j = gl.postEngine(x.company_id, { voucherType: 'JV', date: monthEnd(x.period), narration: `ITC for ${x.period}: reversed ₹${rs(rev.total)} (vendors unpaid beyond the days), re-claimed ₹${rs(rec.total)} (vendors since paid) (${x.doc_no})`, sourceType: 'gst_itc_reviews', sourceId: x.id, lines, user: actor.user }); db.prepare('UPDATE gst_itc_reviews SET journal_id = ? WHERE id = ?').run(j.journal.id, x.id); }
      }
      if (x.amends_id) db.prepare("UPDATE gst_itc_reviews SET status = 'SUPERSEDED', updated_at = ? WHERE id = ? AND status = 'APPROVED'").run(nowIso(), x.amends_id);
      evt('fin.itc_review.approved', actor, x.company_id, 'gst_itc_reviews', x.id, { reviewId: x.id, docNo: x.doc_no, period: x.period, eligible: rs(x.eligible_paise), override: rs(x.override_paise), reversed: rs(x.reversed_paise), claimable: rs(x.claimable_paise), blocked: rs(x.blocked_paise), journalId: x.journal_id ?? null });
    },
  });
  const reviewView = (actor, r, detail = false) => { const o = { id: r.id, docNo: r.doc_no, period: r.period, eligible: rs(r.eligible_paise), blocked: rs(r.blocked_paise), held: rs(r.held_paise), reversed: rs(r.reversed_paise), override: rs(r.override_paise), claimable: rs(r.claimable_paise), status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, journalId: r.journal_id, amendsId: r.amends_id, version: r.version, can: { ...itcFlow.can(actor, r), recompute: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.itc_review.edit') } };
    if (detail) { Object.assign(o.can, itcFlow.approveInfo(actor, r)); o.lines = db.prepare('SELECT * FROM gst_itc_review_lines WHERE review_id = ? AND deleted_at IS NULL ORDER BY decision, invoice_date, id').all(r.id).map((l) => ({ id: l.id, billId: l.bill_id, supplierGstin: l.supplier_gstin, supplier: l.supplier_name, invoiceNo: l.invoice_no, invoiceDate: l.invoice_date, taxable: rs(l.taxable_paise), tax: rs(l.tax_paise), decision: l.decision, decisionLabel: DECISIONS[l.decision], reason: l.reason, claim: rs(l.claim_paise), reverse: rs(l.reverse_paise) })); o.history = itcFlow.history(actor, r.id); }
    return o; };
  const reviews = {
    flow: itcFlow,
    list(actor) { need(actor, 'fin.itc_review.view', 'see ITC reviews'); return db.prepare('SELECT * FROM gst_itc_reviews WHERE company_id = ? AND deleted_at IS NULL ORDER BY period DESC, id DESC LIMIT 60').all(actor.companyId).map((r) => reviewView(actor, r)); },
    get(actor, id) { return reviewView(actor, itcFlow.row(actor, id), true); },
    create(actor, { period }) {
      need(actor, 'fin.itc_review.create', 'make ITC reviews'); if (period > todayIST().slice(0, 7)) throw unprocessable('Review a month that has begun.');
      const live = db.prepare("SELECT id, status FROM gst_itc_reviews WHERE company_id = ? AND period = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId, period); if (live) throw conflict(`The ITC of ${period} already has a review (${live.status === 'APPROVED' ? 'approved: amend it' : 'open'}).`);
      return transaction(db, () => { const id = Number(db.prepare('INSERT INTO gst_itc_reviews (company_id, doc_no, period, requested_by, created_by) VALUES (?, ?, ?, ?, ?)').run(actor.companyId, itcFlow.next(actor), period, actor.user, actor.user).lastInsertRowid); const r = db.prepare('SELECT * FROM gst_itc_reviews WHERE id = ?').get(id); writeLines(r, computeLines(actor.companyId, period)); audit(actor, 'gst_itc_reviews', id, 'create', actor.companyId, { newValues: { period } }); return reviews.get(actor, id); });
    },
    recompute(actor, id) { const r = itcFlow.row(actor, id, 'fin.itc_review.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or returned review is worked out again.'); transaction(db, () => writeLines(r, computeLines(r.company_id, r.period, overridesOf(r.id)))); audit(actor, 'gst_itc_reviews', r.id, 'recompute', r.company_id); return reviews.get(actor, r.id); },
    /** BR-01: the reviewer claims a held invoice, with a reason (never a blocked one); or takes the claim back. */
    override(actor, id, { billId, reason, claim, version }) {
      const r = itcFlow.row(actor, id, 'fin.itc_review.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or returned review is changed.'); if (version !== r.version) throw conflict('Someone changed this review meanwhile: reload it.');
      const ov = overridesOf(r.id); const l = db.prepare('SELECT * FROM gst_itc_review_lines WHERE review_id = ? AND bill_id = ? AND deleted_at IS NULL').get(r.id, billId); if (!l) throw notFound('That invoice is not in this review.');
      if (claim) { if (!['HELD_MISMATCH', 'HELD_NOT_IN_2B', 'OVERRIDE_CLAIM'].includes(l.decision)) throw unprocessable(`${DECISIONS[l.decision]}: only a held invoice is claimed by override.`); if (!reason || reason.trim().length < 10) throw badRequest('Correct the highlighted fields', [{ field: 'reason', message: 'Say why the ITC is claimed although it is held (at least 10 characters).' }]); ov.set(billId, reason.trim()); } else ov.delete(billId);
      transaction(db, () => writeLines(r, computeLines(r.company_id, r.period, ov))); audit(actor, 'gst_itc_reviews', r.id, claim ? 'override' : 'override_removed', r.company_id, { reason: `${l.invoice_no}: ${reason ?? ''}` }); return reviews.get(actor, r.id);
    },
    submit(actor, id) { itcFlow.submit(actor, id); return reviews.get(actor, id); },
    withdraw(actor, id, b) { itcFlow.withdraw(actor, id, b); return reviews.get(actor, id); },
    cancel(actor, id, b) { itcFlow.cancel(actor, id, b); return reviews.get(actor, id); },
    remove: (actor, id) => itcFlow.remove(actor, id),
    history: (actor, id) => itcFlow.history(actor, id),
    /** An approved review changed by a new version (approved again; the old one is then superseded). */
    amend(actor, id) {
      const r = itcFlow.row(actor, id, 'fin.itc_review.amend'); if (r.status !== 'APPROVED') throw conflict('Only an approved review is amended.'); if (r.journal_id) throw unprocessable('Its reversal is posted: reverse the journal first, then amend.');
      if (db.prepare("SELECT 1 FROM gst_itc_reviews WHERE amends_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment is already open.');
      return transaction(db, () => { const nid = Number(db.prepare("INSERT INTO gst_itc_reviews (company_id, doc_no, period, amends_id, requested_by, created_by, status) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')").run(r.company_id, `${r.doc_no}-A${(db.prepare('SELECT COUNT(*) AS n FROM gst_itc_reviews WHERE amends_id = ?').get(r.id).n ?? 0) + 1}`, r.period, r.id, actor.user, actor.user).lastInsertRowid);
        // one open review a month: the amendment is a draft beside the approved one until its own approval supersedes it
        const n = db.prepare('SELECT * FROM gst_itc_reviews WHERE id = ?').get(nid); writeLines(n, computeLines(r.company_id, r.period, overridesOf(r.id))); audit(actor, 'gst_itc_reviews', nid, 'amend', r.company_id, { reason: `amends ${r.doc_no}` }); return reviews.get(actor, nid); });
    },
    print(actor, id) { const r = itcFlow.row(actor, id, 'fin.itc_review.print'); const v = reviews.get(actor, r.id); audit(actor, 'gst_itc_reviews', r.id, 'print', r.company_id); return { contentType: 'application/pdf', fileName: `itc-review-${r.period}.pdf`, buffer: toPdf({ title: `ITC review ${v.docNo} (${v.period})`, columns: [{ key: 'd', label: 'Decision' }, { key: 's', label: 'Supplier' }, { key: 'g', label: 'GSTIN' }, { key: 'n', label: 'Invoice' }, { key: 'dt', label: 'Date' }, { key: 't', label: 'GST' }, { key: 'c', label: 'Claim' }, { key: 'r', label: 'Reverse' }, { key: 'w', label: 'Why' }], rows: v.lines.map((l) => ({ d: l.decisionLabel, s: l.supplier, g: l.supplierGstin ?? '', n: l.invoiceNo, dt: l.invoiceDate, t: l.tax, c: l.claim, r: l.reverse, w: l.reason ?? '' })), footer: [`Eligible ${v.eligible} + override ${v.override} - reversed ${v.reversed} = claimable ${v.claimable}; blocked ${v.blocked}; held ${v.held}. ${v.statusLabel}${v.approvedBy ? ` by ${v.approvedBy}` : ''}.`] }) }; },
    exportCsv(actor, id) { const r = itcFlow.row(actor, id, 'fin.itc_review.export'); const v = reviews.get(actor, r.id); audit(actor, 'gst_itc_reviews', r.id, 'export', r.company_id); return { contentType: 'text/csv; charset=utf-8', fileName: `itc-review-${r.period}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Decision', 'Supplier', 'GSTIN', 'Invoice', 'Date', 'Taxable', 'GST', 'Claim', 'Reverse', 'Why'], v.lines.map((l) => [l.decisionLabel, l.supplier, l.supplierGstin ?? '', l.invoiceNo, l.invoiceDate, l.taxable, l.tax, l.claim, l.reverse, l.reason ?? '']))}`, 'utf8') }; },
  };

  // ---- FR-04: GSTR-1 and GSTR-3B ----
  function gstr1(companyId, period) {
    const from = `${period}-01`; const to = monthEnd(period);
    const inv = db.prepare("SELECT invoice_no, invoice_date, gstin_to, place_state, sac_code, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, gst_pct_bp FROM bill_tax_invoices WHERE company_id = ? AND status = 'APPROVED' AND invoice_no IS NOT NULL AND invoice_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY invoice_date, invoice_no").all(companyId, from, to);
    const other = db.prepare("SELECT x.invoice_no, x.invoice_date, x.taxable_paise, x.gst_paise, x.amount_paise, (SELECT g.gstin FROM mdm_partner_gstins g WHERE g.partner_id = x.partner_id AND g.gstin_status = 'ACTIVE' AND g.deleted_at IS NULL ORDER BY g.id LIMIT 1) AS gstin FROM ar_invoices x WHERE x.company_id = ? AND x.inv_source = 'OTHER_INCOME' AND x.status = 'APPROVED' AND x.invoice_date BETWEEN ? AND ? AND x.deleted_at IS NULL").all(companyId, from, to);
    const notes = db.prepare("SELECT n.doc_no, n.note_date, n.taxable_paise, n.cgst_paise, n.sgst_paise, n.igst_paise, n.total_paise, (SELECT g.gstin FROM mdm_partner_gstins g WHERE g.partner_id = n.partner_id AND g.gstin_status = 'ACTIVE' AND g.deleted_at IS NULL ORDER BY g.id LIMIT 1) AS gstin FROM ar_credit_notes n WHERE n.company_id = ? AND n.status = 'APPROVED' AND n.note_date BETWEEN ? AND ? AND n.deleted_at IS NULL").all(companyId, from, to);
    const own = ownStates(companyId);
    const b2b = [...inv.map((i) => ({ gstin: i.gstin_to, no: i.invoice_no, date: i.invoice_date, pos: i.place_state, taxable: i.taxable_paise, igst: i.igst_paise, cgst: i.cgst_paise, sgst: i.sgst_paise, value: i.total_paise, rate: i.gst_pct_bp / 100, hsn: i.sac_code })), ...other.filter((o) => o.gstin).map((o) => { const inter = own.size && !own.has(o.gstin.slice(0, 2)); return { gstin: o.gstin, no: o.invoice_no, date: o.invoice_date, pos: o.gstin.slice(0, 2), taxable: o.taxable_paise, igst: inter ? o.gst_paise : 0, cgst: inter ? 0 : Math.round(o.gst_paise / 2), sgst: inter ? 0 : o.gst_paise - Math.round(o.gst_paise / 2), value: o.amount_paise, rate: o.taxable_paise ? Math.round((o.gst_paise * 100) / o.taxable_paise) : 0, hsn: null }; })];
    const b2cs = other.filter((o) => !o.gstin).map((o) => ({ no: o.invoice_no, date: o.invoice_date, taxable: o.taxable_paise, tax: o.gst_paise }));
    const cdnr = notes.map((n) => ({ gstin: n.gstin, no: n.doc_no, date: n.note_date, taxable: n.taxable_paise, igst: n.igst_paise, cgst: n.cgst_paise, sgst: n.sgst_paise, value: n.total_paise }));
    const hsn = new Map(); for (const x of b2b) { const k = x.hsn ?? 'NA'; const h = hsn.get(k) ?? { hsn: k, taxable: 0, igst: 0, cgst: 0, sgst: 0, count: 0 }; for (const f of ['taxable', 'igst', 'cgst', 'sgst']) h[f] += x[f]; h.count += 1; hsn.set(k, h); }
    const sum = (a, k) => a.reduce((s, x) => s + (x[k] ?? 0), 0);
    return { b2b, b2cs, cdnr, hsn: [...hsn.values()], totals: { taxable: sum(b2b, 'taxable') + sum(b2cs, 'taxable') - sum(cdnr, 'taxable'), igst: sum(b2b, 'igst') - sum(cdnr, 'igst'), cgst: sum(b2b, 'cgst') - sum(cdnr, 'cgst'), sgst: sum(b2b, 'sgst') - sum(cdnr, 'sgst'), b2csTax: sum(b2cs, 'tax'), invoices: b2b.length + b2cs.length, notes: cdnr.length } };
  }
  /** Head-wise set-off (s.49(5), Rule 88A): IGST credit first against IGST, then CGST, then SGST; CGST credit against CGST, then IGST; SGST credit against SGST, then IGST; CGST never against SGST or the reverse. */
  function setOff(liability, credit) {
    const due = { ...liability }; const cr = { igst: Math.max(0, credit.igst), cgst: Math.max(0, credit.cgst), sgst: Math.max(0, credit.sgst) }; const utilised = [];
    const use = (from, to) => { const v = Math.min(cr[from], due[to]); if (v > 0) { cr[from] -= v; due[to] -= v; utilised.push({ from, to, amount: v }); } };
    use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst'); use('cgst', 'cgst'); use('cgst', 'igst'); use('sgst', 'sgst'); use('sgst', 'igst');
    return { utilised, cash: due, carry: cr };
  }
  function gstr3b(companyId, period) {
    const g1 = gstr1(companyId, period); const rv = db.prepare("SELECT * FROM gst_itc_reviews WHERE company_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId, period);
    const rcm = db.prepare('SELECT COALESCE(SUM(taxable_paise), 0) AS t, COALESCE(SUM(igst_paise + cgst_paise + sgst_paise + cess_paise), 0) AS g FROM gst_2b_lines WHERE company_id = ? AND period = ? AND reverse_charge = 1 AND deleted_at IS NULL').get(companyId, period);
    const output = g1.totals.igst + g1.totals.cgst + g1.totals.sgst + g1.totals.b2csTax;
    // D-738: the ITC by head from the review (claimed less reversed), set off head-wise against the output tax (s.49, Rule 88A), the rest paid in cash
    const claim = rv ? headsOf(rv.id, ['ELIGIBLE', 'OVERRIDE_CLAIM', 'RECLAIMED_PAID'], 'claim_paise') : { igst: 0, cgst: 0, sgst: 0, total: 0 }; const rev = rv ? headsOf(rv.id, 'REVERSED_UNPAID_180', 'reverse_paise') : { igst: 0, cgst: 0, sgst: 0, total: 0 };
    const reclaimed = rv ? headsOf(rv.id, 'RECLAIMED_PAID', 'claim_paise').total : 0; const itc = claim.total; const reversed = rev.total;
    const b2csHalf = Math.round(g1.totals.b2csTax / 2); const liability = { igst: Math.max(0, g1.totals.igst), cgst: Math.max(0, g1.totals.cgst + b2csHalf), sgst: Math.max(0, g1.totals.sgst + g1.totals.b2csTax - b2csHalf) };
    const set = setOff(liability, { igst: claim.igst - rev.igst, cgst: claim.cgst - rev.cgst, sgst: claim.sgst - rev.sgst });
    const filed = db.prepare("SELECT filed_on FROM gst_return_filings WHERE company_id = ? AND return_type = 'GSTR3B' AND period = ? AND filing_status = 'FILED' AND deleted_at IS NULL").get(companyId, period)?.filed_on ?? null;
    const due = `${addMonths(period, 1)}-${String(GSTR3B_DUE_DAY).padStart(2, '0')}`; const asOf = filed ?? todayIST(); const late = asOf > due ? daysBetween(due, asOf) : 0;
    const cash = set.cash.igst + set.cash.cgst + set.cash.sgst + rcm.g; const interest = Math.round((cash * GST_INTEREST_BP * late) / (10000 * 365)); const nil = output === 0 && rcm.g === 0;
    const feeHead = Math.min(late * (nil ? LATE_FEE_NIL_PER_HEAD : LATE_FEE_PER_HEAD), nil ? LATE_FEE_NIL_CAP_PER_HEAD : LATE_FEE_CAP_PER_HEAD);
    return { outward: { taxable: g1.totals.taxable, igst: g1.totals.igst, cgst: g1.totals.cgst, sgst: g1.totals.sgst, b2csTax: g1.totals.b2csTax, tax: output }, inwardRcm: { taxable: rcm.t, tax: rcm.g }, itc: { available: itc, reversed, reclaimed, ineligible: rv ? rv.blocked_paise : 0, net: itc - reversed, byHead: { igst: claim.igst - rev.igst, cgst: claim.cgst - rev.cgst, sgst: claim.sgst - rev.sgst }, review: rv ? { id: rv.id, docNo: rv.doc_no } : null },
      setOff: { liability, utilised: set.utilised, cash: set.cash, carryForward: set.carry }, payable: cash, carryForward: set.carry.igst + set.carry.cgst + set.carry.sgst,
      dueDate: due, filedOn: filed, daysLate: late, interest: { ratePct: GST_INTEREST_BP / 100, on: cash, amount: interest }, lateFee: { cgst: feeHead, sgst: feeHead, total: 2 * feeHead, nil }, totalDue: cash + interest + 2 * feeHead };
  }
  const money = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && !['count', 'invoices', 'notes', 'rate', 'id', 'ratePct', 'daysLate'].includes(k) ? v / 100 : v)));
  const returns = {
    gst(actor, { period }) {
      need(actor, 'fin.gst_return.view', 'see the GST returns'); const c = actor.companyId; const gstin = gst()?.ownGstins(c)?.[0]?.gstin ?? null;
      const filings = Object.fromEntries(db.prepare('SELECT * FROM gst_return_filings WHERE company_id = ? AND period = ? AND deleted_at IS NULL').all(c, period).map((f) => [f.return_type, { status: f.filing_status, arn: f.arn, filedOn: f.filed_on, filedBy: f.filed_by, preparedAt: f.updated_at ?? f.created_at }]));
      const trend = []; for (let k = 5; k >= 0; k -= 1) { const p = addMonths(period, -k); const g = gstr3b(c, p); trend.push({ period: p, output: rs(g.outward.tax), itc: rs(g.itc.net) }); }
      return { period, gstin, gstr1: money(gstr1(c, period)), gstr3b: money(gstr3b(c, period)), filings, trend, can: { prepare: may(actor, 'fin.gst_return.prepare'), file: may(actor, 'fin.gst_return.file') } };
    },
    prepareReturn(actor, { period, returnType }) {
      need(actor, 'fin.gst_return.prepare', 'prepare GST returns'); const c = actor.companyId; const gstin = gst()?.ownGstins(c)?.[0]?.gstin; if (!gstin) throw unprocessable('The company has no GSTIN.');
      if (returnType === 'GSTR3B' && !db.prepare("SELECT 1 FROM gst_itc_reviews WHERE company_id = ? AND period = ? AND status = 'APPROVED'").get(c, period)) throw unprocessable('Approve the ITC review of the month first: GSTR-3B takes its ITC from it.');
      const old = db.prepare('SELECT * FROM gst_return_filings WHERE company_id = ? AND return_type = ? AND period = ? AND gstin = ?').get(c, returnType, period, gstin); if (old?.filing_status === 'FILED') throw conflict('This return is filed; amendments go in a later return.');
      const data = JSON.stringify(returnType === 'GSTR1' ? gstr1(c, period) : gstr3b(c, period));
      if (old) db.prepare('UPDATE gst_return_filings SET data_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(data, actor.user, nowIso(), old.id); else db.prepare('INSERT INTO gst_return_filings (company_id, return_type, period, gstin, data_json, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(c, returnType, period, gstin, data, actor.user);
      audit(actor, 'gst_return_filings', old?.id ?? 0, 'prepare', c, { reason: `${returnType} ${period}` }); return returns.gst(actor, { period });
    },
    file(actor, { period, returnType, arn, filedOn }) {
      need(actor, 'fin.gst_return.file', 'mark GST returns filed'); const c = actor.companyId; const f = db.prepare("SELECT * FROM gst_return_filings WHERE company_id = ? AND return_type = ? AND period = ? AND deleted_at IS NULL").get(c, returnType, period); if (!f) throw unprocessable('Prepare the return first.'); if (f.filing_status === 'FILED') throw conflict('Already filed.');
      db.prepare("UPDATE gst_return_filings SET filing_status = 'FILED', arn = ?, filed_on = ?, filed_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(arn, filedOn, actor.user, nowIso(), f.id); audit(actor, 'gst_return_filings', f.id, 'file', c, { newValues: { arn, filedOn } }); evt('fin.gst_return.filed', actor, c, 'gst_return_filings', f.id, { returnType, period, arn, filedOn }); return returns.gst(actor, { period });
    },
    exportJson(actor, { period, returnType }) { need(actor, 'fin.gst_return.export', 'export GST returns'); const c = actor.companyId; const data = returnType === 'GSTR1' ? gstr1(c, period) : gstr3b(c, period); audit(actor, 'gst_return_filings', 0, 'export', c, { reason: `${returnType} ${period}` }); return { contentType: 'application/json; charset=utf-8', fileName: `${returnType.toLowerCase()}-${period}.json`, buffer: Buffer.from(JSON.stringify({ gstin: gst()?.ownGstins(c)?.[0]?.gstin ?? null, fp: `${period.slice(5, 7)}${period.slice(0, 4)}`, ...money(data) }, null, 2)) }; },
  };

  // ---- FR-05: TDS ----
  const maskPan = (p) => (p ? `${p.slice(0, 3)}•••••${p.slice(-2)}` : null);
  /** D-736: the TCS collected on scrap sales in a quarter, in the shape of the TDS rows (rate × 10 000 of a per cent as there). */
  function tcsRows(companyId, quarter) {
    const { from, to } = quarterRange(quarter); if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tcs_collections'").get()) return [];
    return db.prepare("SELECT t.id, i.doc_no, t.collected_on AS bill_date, p.legal_name AS payee_name, t.section AS tds_section, t.rate_bp * 100 AS tds_rate, t.base_paise AS tds_base_paise, t.tcs_paise AS tds_paise, t.partner_id, COALESCE(t.pan, p.pan) AS pan, p.legal_name, p.constitution FROM tcs_collections t JOIN ar_invoices i ON i.id = t.invoice_id LEFT JOIN mdm_partners p ON p.id = t.partner_id WHERE t.company_id = ? AND t.tcs_status = 'COLLECTED' AND t.collected_on BETWEEN ? AND ? AND t.deleted_at IS NULL ORDER BY t.collected_on, t.id").all(companyId, from, to);
  }
  function tdsRows(companyId, quarter) {
    const { from, to } = quarterRange(quarter);
    return db.prepare("SELECT b.id, b.doc_no, b.bill_date, b.payee_name, b.tds_section, b.tds_rate, b.tds_base_paise, b.tds_paise, b.partner_id, p.pan, p.legal_name, p.constitution FROM ap_bills b LEFT JOIN mdm_partners p ON p.id = b.partner_id WHERE b.company_id = ? AND b.status = 'APPROVED' AND b.tds_paise > 0 AND b.bill_date BETWEEN ? AND ? AND b.deleted_at IS NULL ORDER BY b.bill_date, b.id").all(companyId, from, to);
  }
  const tdsView = (actor, r, rows) => { const full = may(actor, 'fin.tds_return.export'); const challans = json(r?.challans_json ?? '[]', []); const deducted = rows.reduce((a, x) => a + x.tds_paise, 0); const deposited = challans.reduce((a, x) => a + paise(x.amount), 0);
    const deductees = new Map(); for (const x of rows) { const k = x.partner_id ?? x.payee_name; const d = deductees.get(k) ?? { partnerId: x.partner_id, name: x.legal_name ?? x.payee_name, pan: full ? x.pan : maskPan(x.pan), sections: new Set(), paid: 0, tds: 0, entries: 0 }; d.sections.add(x.tds_section); d.paid += x.tds_base_paise; d.tds += x.tds_paise; d.entries += 1; deductees.set(k, d); }
    return { id: r?.id ?? null, docNo: r?.doc_no ?? null, status: r?.return_status ?? 'DRAFT', tokenNo: r?.token_no ?? null, filedOn: r?.filed_on ?? null, deducted: rs(deducted), deposited: rs(deposited), shortfall: rs(Math.max(0, deducted - deposited)), challans, rows: rows.map((x) => ({ billId: x.id, docNo: x.doc_no, date: x.bill_date, deductee: x.legal_name ?? x.payee_name, pan: full ? x.pan : maskPan(x.pan), noPan: !x.pan, section: x.tds_section, rate: x.tds_rate / 10000, paid: rs(x.tds_base_paise), tds: rs(x.tds_paise) })), deductees: [...deductees.values()].map((d) => ({ ...d, sections: [...d.sections].join(', '), paid: rs(d.paid), tds: rs(d.tds) })), version: r?.version ?? null }; };
  function makeStatement(K) {
  const tds = {
    quarter(actor, { quarter }) {
      need(actor, 'fin.tds_return.view', 'see TDS returns'); const c = actor.companyId; const { from, to } = quarterRange(quarter); const f = K.forms(c, to);
      const r = db.prepare('SELECT * FROM tds_returns WHERE company_id = ? AND quarter = ? AND form = ? AND deleted_at IS NULL').get(c, quarter, f.form ?? K.defaultForm);
      return { quarter, from, to, kind: K.kind, ...f, ...tdsView(actor, r, K.rows(c, quarter)), ...(K.kind === 'TDS' ? { tcs: K.tcsSummary(c, quarter) } : {}), can: { prepare: may(actor, 'fin.tds_return.prepare'), file: may(actor, 'fin.tds_return.file'), certificate: may(actor, 'fin.tds_return.certificate') } };
    },
    /** The statement of the quarter prepared (its data frozen) with the challans that paid it. */
    /** D-737: the TDS deposited in the books (journals debiting TDS payable 230004) from the quarter's start to its due date, and to which statement each challan is linked. */
    deposits(actor, { quarter }) {
      need(actor, 'fin.tds_return.view', 'see TDS returns'); const c = actor.companyId; const { from } = quarterRange(quarter); const until = K.due(quarter);
      const linked = new Map(); for (const r of db.prepare('SELECT quarter, form, challans_json FROM tds_returns WHERE company_id = ? AND deleted_at IS NULL').all(c)) for (const x of json(r.challans_json, [])) if (x.journalId) linked.set(Number(x.journalId), `${r.form} ${r.quarter}`);
      return { quarter, from, to: until, rows: db.prepare("SELECT j.id, j.doc_no, j.voucher_no, j.voucher_date, j.narration, SUM(l.debit_paise) - SUM(l.credit_paise) AS amt FROM fin_journal_lines l JOIN fin_journals j ON j.id = l.journal_id JOIN fin_accounts a ON a.id = l.account_id WHERE j.company_id = ? AND a.code = ? AND j.status = 'APPROVED' AND j.deleted_at IS NULL AND l.deleted_at IS NULL AND j.voucher_date BETWEEN ? AND ? GROUP BY j.id HAVING amt > 0 ORDER BY j.voucher_date, j.id").all(c, K.account, from, until).map((j) => ({ journalId: j.id, voucherNo: j.voucher_no ?? j.doc_no, date: j.voucher_date, narration: j.narration, amount: rs(j.amt), linkedTo: linked.get(j.id) ?? null })) };
    },
    prepareStatement(actor, { quarter, challans, tan }) {
      need(actor, 'fin.tds_return.prepare', 'prepare TDS returns'); const c = actor.companyId; const v = tds.quarter(actor, { quarter }); if (!v.form) throw unprocessable('No TDS form is in force for this quarter (forms master, 166.8).');
      const old = db.prepare('SELECT * FROM tds_returns WHERE company_id = ? AND quarter = ? AND form = ?').get(c, quarter, v.form); if (old?.return_status === 'FILED') throw conflict('This statement is filed; a correction statement is made on the portal.');
      const ch = challans ?? json(old?.challans_json ?? '[]', []); const dep = ch.reduce((a, x) => a + paise(x.amount), 0); const ded = paise(v.deducted);
      // D-737: a challan linked to the deposit in the books carries its amount; a deposit is linked to one statement only
      const dl = new Map(tds.deposits(actor, { quarter }).rows.map((x) => [x.journalId, x])); const problems = [];
      ch.forEach((x, i) => { if (!x.journalId) return; const j = dl.get(Number(x.journalId)); if (!j) problems.push({ field: `challans.${i}.journalId`, message: 'Not a TDS deposit in the books for this quarter' }); else if (j.linkedTo && j.linkedTo !== `${v.form} ${quarter}`) problems.push({ field: `challans.${i}.journalId`, message: `Already linked to the statement ${j.linkedTo}` }); else if (paise(j.amount) !== paise(x.amount)) problems.push({ field: `challans.${i}.amount`, message: `The deposit in the books is ₹${j.amount}` }); });
      if (new Set(ch.filter((x) => x.journalId).map((x) => Number(x.journalId))).size !== ch.filter((x) => x.journalId).length) problems.push({ field: 'challans', message: 'A deposit is linked to one challan only' });
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      const tanNo = tan ?? json(old?.data_json ?? '{}', {}).tan ?? null;
      const rows = K.rows(c, quarter); const data = JSON.stringify({ form: v.form, quarter, tan: tanNo, deductees: rows.map((x) => ({ pan: x.pan, name: x.legal_name ?? x.payee_name, section: x.tds_section, date: x.bill_date, paid: rs(x.tds_base_paise), tds: rs(x.tds_paise), rate: x.tds_rate / 10000 })) });
      const status = dep >= ded && ded > 0 ? 'PREPARED' : 'DRAFT';
      if (old) db.prepare('UPDATE tds_returns SET data_json = ?, challans_json = ?, deducted_paise = ?, deposited_paise = ?, return_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(data, JSON.stringify(ch), ded, dep, status, actor.user, nowIso(), old.id);
      else db.prepare('INSERT INTO tds_returns (company_id, doc_no, quarter, form, data_json, challans_json, deducted_paise, deposited_paise, return_status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c, docNo(c, 'tds_returns', 'TDSR'), quarter, v.form, data, JSON.stringify(ch), ded, dep, status, actor.user);
      audit(actor, 'tds_returns', old?.id ?? 0, 'prepare', c, { reason: `${v.form} ${quarter}: deducted ₹${rs(ded)}, deposited ₹${rs(dep)}` }); return tds.quarter(actor, { quarter });
    },
    /** D-737: the statement as the text file the FVU (file validation utility of the TIN) takes: '^'-separated records — the file header (FH), the batch
     *  header (BH), a challan (CD) for each challan and under it the deductee records (DD) it paid, in date order. Validate it with the FVU of the form's version before filing. */
    textFile(actor, { quarter }) {
      need(actor, 'fin.tds_return.export', 'export TDS returns'); const c = actor.companyId; const v = tds.quarter(actor, { quarter }); const r = db.prepare('SELECT * FROM tds_returns WHERE company_id = ? AND quarter = ? AND form = ? AND deleted_at IS NULL').get(c, quarter, v.form);
      if (!r || r.return_status === 'DRAFT') throw unprocessable('Prepare the statement with challans covering the tax deducted first.'); const data = json(r.data_json, {}); if (!data.tan) throw unprocessable('Give the TAN of the deductor when preparing the statement.');
      const comp = db.prepare('SELECT legal_name, pan, address_json FROM core_company_settings WHERE company_id = ?').get(c) ?? {}; const addr = json(comp.address_json ?? '{}', {}); const dmy = (d) => (d ? `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}` : ''); const amt = (p2) => (p2 / 100).toFixed(2); const clean = (x) => String(x ?? '').replace(/[\^\r\n]/g, ' ').trim();
      const fy = Number(quarter.slice(0, 4)); const fyS = `${fy}${String((fy + 1) % 100).padStart(2, '0')}`; const ay = `${fy + 1}${String((fy + 2) % 100).padStart(2, '0')}`; const challans = json(r.challans_json, []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const rows = K.rows(c, quarter); const lines = []; let n = 0; const rec = (...f) => { n += 1; lines.push([n, ...f].map(clean).join('^')); };
      rec('FH', 'NS1', 'R', dmy(todayIST()), 1, 'D', data.tan, 1, 'ERP', '', '', '', '', '', '', '', '', '');
      rec('BH', 1, challans.length, v.form, '', '', '', '', '', '', '', data.tan, '', comp.pan ?? '', ay, fyS, `Q${quarter.slice(-1)}`, comp.legal_name ?? '', '', addr.line1 ?? '', addr.line2 ?? '', '', '', '', addr.city ?? '', addr.stateCode ?? '', addr.pin ?? '', '', '', '', 'N', '', 'D', '', '', '', amt(rows.reduce((a, x) => a + x.tds_paise, 0)));
      let i = 0; let left = rows.map((x) => ({ ...x })); for (const ch of challans) {
        i += 1; let cap = paise(ch.amount); const mine = []; while (left.length && cap > 0) { const x = left[0]; const take = Math.min(cap, x.tds_paise); mine.push({ ...x, tds_paise: take }); cap -= take; x.tds_paise -= take; if (x.tds_paise <= 0) left.shift(); }
        rec('CD', 1, i, mine.length, 'N', '', '', '', '', '', ch.serial, '', '', ch.bsr, '', dmy(ch.date), '', '', mine[0]?.tds_section ?? '', amt(paise(ch.amount)), '0.00', '0.00', '0.00', '0.00', '0.00', amt(paise(ch.amount)), '', amt(mine.reduce((a, x) => a + x.tds_paise, 0)), '', '', '', 'N');
        mine.forEach((x, k) => rec('DD', 1, i, k + 1, 'O', '', x.constitution === 'INDIVIDUAL' ? '02' : '01', '', x.pan ?? 'PANNOTAVBL', '', x.legal_name ?? x.payee_name, amt(x.tds_paise), '0.00', '0.00', amt(x.tds_paise), '', amt(x.tds_paise), '', amt(x.tds_base_paise), dmy(x.bill_date), dmy(x.bill_date), '', (x.tds_rate / 10000).toFixed(4), '', '', x.pan ? '' : 'C', '', x.tds_section ?? ''));
      }
      audit(actor, 'tds_returns', r.id, 'export', c, { reason: `${v.form} ${quarter} text file: ${challans.length} challan(s), ${rows.length} deductee record(s)` });
      return { contentType: 'text/plain; charset=utf-8', fileName: `${data.tan}_${v.form}_${quarter}.txt`, buffer: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8') };
    },
    file(actor, { quarter, tokenNo, filedOn }) {
      need(actor, 'fin.tds_return.file', 'mark TDS returns filed'); const c = actor.companyId; const v = tds.quarter(actor, { quarter }); const r = db.prepare('SELECT * FROM tds_returns WHERE company_id = ? AND quarter = ? AND form = ?').get(c, quarter, v.form);
      if (!r) throw unprocessable('Prepare the statement first.'); if (r.return_status === 'FILED') throw conflict('Already filed.'); if (r.return_status !== 'PREPARED') throw unprocessable(`The challans cover ₹${rs(r.deposited_paise)} of ₹${rs(r.deducted_paise)} deducted: deposit the rest before filing.`);
      db.prepare("UPDATE tds_returns SET return_status = 'FILED', token_no = ?, filed_on = ?, filed_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(tokenNo, filedOn, actor.user, nowIso(), r.id); audit(actor, 'tds_returns', r.id, 'file', c, { newValues: { tokenNo, filedOn } }); evt('fin.tds_return.filed', actor, c, 'tds_returns', r.id, { quarter, form: v.form, tokenNo, filedOn }); return tds.quarter(actor, { quarter });
    },
    /** The certificate (Form 16A before April 2026, Form 131 after) of one deductee for a quarter, from the return filed. */
    certificate(actor, { quarter, partnerId }) {
      need(actor, 'fin.tds_return.certificate', 'issue TDS certificates'); const c = actor.companyId; const v = tds.quarter(actor, { quarter }); if (v.status !== 'FILED') throw unprocessable('A certificate is issued from a filed statement.');
      const rows = K.rows(c, quarter).filter((x) => x.partner_id === partnerId); if (!rows.length) throw notFound('That deductee has no TDS in the quarter.'); const comp = db.prepare('SELECT legal_name, pan FROM core_company_settings WHERE company_id = ?').get(c);
      audit(actor, 'tds_returns', v.id, 'certificate', c, { reason: `${v.certificate} ${quarter} partner ${partnerId}` });
      return { contentType: 'application/pdf', fileName: `form-${v.certificate}-${quarter}-${partnerId}.pdf`, buffer: toPdf({ title: `Form ${v.certificate}: TDS certificate`, columns: [{ key: 'd', label: 'Date of credit' }, { key: 'b', label: 'Bill' }, { key: 's', label: 'Section' }, { key: 'p', label: 'Amount paid/credited' }, { key: 't', label: 'Tax deducted' }], rows: rows.map((x) => ({ d: x.bill_date, b: x.doc_no, s: x.tds_section, p: rs(x.tds_base_paise), t: rs(x.tds_paise) })), footer: [`Deductor: ${comp?.legal_name ?? ''} (PAN ${comp?.pan ?? ''}). Deductee: ${rows[0].legal_name} (PAN ${rows[0].pan ?? 'not given'}). Quarter ${quarter}, statement ${v.form} token ${v.tokenNo}. Total deducted Rs ${rs(rows.reduce((a, x) => a + x.tds_paise, 0))}.`] }) };
    },
    /** 26AS / AIS lines (CSV: TAN, deductor, section, date, amount, TDS) matched to the TDS clients deducted from their receipts (23.05). */
    import26as(actor, { fy, content }) {
      need(actor, 'fin.tds_return.prepare', 'import Form 26AS'); const c = actor.companyId; const rows = String(content).split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(',').map((x) => x.trim())); const h = (rows[0] ?? []).map((x) => x.toLowerCase()); const col = (re) => h.findIndex((x) => re.test(x));
      const I = { tan: col(/tan/), name: col(/name|deductor/), section: col(/section/), date: col(/date/), amount: col(/amount|paid|credited/), tds: col(/tds|tax/) }; if (I.tan < 0 || I.date < 0 || I.tds < 0) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'The header must name the TAN, the date and the TDS.' }]);
      let added = 0; const ins = db.prepare('INSERT OR IGNORE INTO tds_26as_lines (company_id, fy, line_hash, deductor_tan, deductor_name, section, txn_date, amount_paise, tds_paise, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      transaction(db, () => { for (const r of rows.slice(1)) { const d = toIso(r[I.date]); if (!d) continue; const t = paise(String(r[I.tds]).replace(/[,₹]/g, '')); const a = I.amount >= 0 ? paise(String(r[I.amount]).replace(/[,₹]/g, '')) : 0; const hsh = createHash('sha256').update([r[I.tan], d, t, a, r[I.section] ?? ''].join('|')).digest('hex'); added += ins.run(c, fy, hsh, r[I.tan].toUpperCase(), I.name >= 0 ? r[I.name] : null, I.section >= 0 ? r[I.section] : null, d, a, t, actor.user).changes; } });
      // match: same TDS, a receipt within 15 days, not taken
      const taken = new Set(db.prepare('SELECT matched_receipt_id AS r FROM tds_26as_lines WHERE company_id = ? AND matched_receipt_id IS NOT NULL').all(c).map((x) => x.r)); let matched = 0;
      for (const l of db.prepare("SELECT * FROM tds_26as_lines WHERE company_id = ? AND fy = ? AND match_status <> 'MATCHED' ORDER BY txn_date, id").all(c, fy)) {
        const cands = db.prepare("SELECT id, tds_paise, receipt_date FROM ar_receipts WHERE company_id = ? AND status = 'APPROVED' AND tds_paise > 0 AND receipt_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY ABS(julianday(receipt_date) - julianday(?)), id").all(c, addDays(l.txn_date, -15), addDays(l.txn_date, 15), l.txn_date).filter((x) => !taken.has(x.id));
        const same = cands.find((x) => x.tds_paise === l.tds_paise); const any = cands[0];
        if (same) { taken.add(same.id); matched += 1; db.prepare("UPDATE tds_26as_lines SET matched_receipt_id = ?, match_status = 'MATCHED', diff_paise = 0, updated_at = ? WHERE id = ?").run(same.id, nowIso(), l.id); } else if (any && Math.abs(any.tds_paise - l.tds_paise) <= 10000) { taken.add(any.id); db.prepare("UPDATE tds_26as_lines SET matched_receipt_id = ?, match_status = 'DIFFERENCE', diff_paise = ?, updated_at = ? WHERE id = ?").run(any.id, l.tds_paise - any.tds_paise, nowIso(), l.id); }
      }
      audit(actor, 'tds_26as_lines', 0, 'import', c, { reason: `${fy}: ${added} line(s), ${matched} matched` }); return { added, matched, ...tds.recon26as(actor, { fy }) };
    },
    recon26as(actor, { fy }) {
      need(actor, 'fin.tds_return.view', 'see the 26AS reconciliation'); const c = actor.companyId; const start = `${fy.slice(0, 4)}-04-01`; const end = `${Number(fy.slice(0, 4)) + 1}-03-31`;
      const lines = db.prepare('SELECT * FROM tds_26as_lines WHERE company_id = ? AND fy = ? AND deleted_at IS NULL ORDER BY txn_date, id').all(c, fy);
      const matchedIds = new Set(lines.map((l) => l.matched_receipt_id).filter(Boolean));
      const books0 = db.prepare("SELECT r.id, r.doc_no, r.receipt_date, r.tds_paise, p.legal_name FROM ar_receipts r JOIN mdm_partners p ON p.id = r.partner_id WHERE r.company_id = ? AND r.status = 'APPROVED' AND r.tds_paise > 0 AND r.receipt_date BETWEEN ? AND ? AND r.deleted_at IS NULL ORDER BY r.receipt_date").all(c, start, end);
      return { fy, in26as: rs(lines.reduce((a, l) => a + l.tds_paise, 0)), inBooks: rs(books0.reduce((a, r) => a + r.tds_paise, 0)), lines: lines.map((l) => ({ id: l.id, tan: l.deductor_tan, deductor: l.deductor_name, section: l.section, date: l.txn_date, amount: rs(l.amount_paise), tds: rs(l.tds_paise), status: l.match_status, receiptId: l.matched_receipt_id, diff: rs(l.diff_paise) })), notIn26as: books0.filter((r) => !matchedIds.has(r.id)).map((r) => ({ receiptId: r.id, docNo: r.doc_no, date: r.receipt_date, client: r.legal_name, tds: rs(r.tds_paise) })) };
    },
  };
  return tds;
  }
  // D-736: the TDS statement (26Q / Form 140) of the AP bills and the TCS statement (27EQ) of the scrap sales, the same way
  const tds = makeStatement({ kind: 'TDS', defaultForm: '26Q', account: '230004', due: depositDue, rows: tdsRows, forms: (c, to) => { const form = statutory.resolve.form(c, { purpose: 'NON_SALARY_RETURN', date: to }); const cert = statutory.resolve.form(c, { purpose: 'NON_SALARY_CERT', date: to }); return { form: form?.formCode ?? null, formAct: form?.act ?? null, certificate: cert?.formCode ?? null }; },
    tcsSummary: (c, quarter) => { const rows = tcsRows(c, quarter); return { form: '27EQ', collections: rows.length, collected: rs(rows.reduce((a, x) => a + x.tds_paise, 0)) }; } });
  const tcs = makeStatement({ kind: 'TCS', defaultForm: '27EQ', account: '230007', due: tcsDue, rows: tcsRows, forms: () => ({ form: '27EQ', formAct: null, certificate: '27D' }) });

  // ---- FR-06: the compliance calendar ----
  function calendar(actor, { from, to }) {
    need(actor, 'fin.gst_return.view', 'see the compliance calendar'); const c = actor.companyId; const today = todayIST();
    const f = from ?? addMonths(today.slice(0, 7), -3); const t = to ?? addMonths(today.slice(0, 7), 2);
    const rows = statutory.dues(c, { from: f, to: t }).map((r) => {
      const ym = r.periodEnd.slice(0, 7); let done = null;
      if (r.code === 'GSTR1' || r.code === 'GSTR3B') { const x = db.prepare("SELECT arn, filed_on FROM gst_return_filings WHERE company_id = ? AND return_type = ? AND period = ? AND filing_status = 'FILED'").get(c, r.code, ym); if (x) done = { ref: x.arn, on: x.filed_on }; }
      else if (r.code === 'GSTR2B_RECON') { const x = db.prepare("SELECT doc_no, approved_at FROM gst_itc_reviews WHERE company_id = ? AND period = ? AND status = 'APPROVED'").get(c, ym); if (x) done = { ref: x.doc_no, on: String(x.approved_at).slice(0, 10) }; }
      else if (r.purpose === 'NON_SALARY_RETURN') { const x = db.prepare("SELECT token_no, filed_on FROM tds_returns WHERE company_id = ? AND quarter = ? AND return_status = 'FILED'").get(c, quarterOf(r.periodEnd)); if (x) done = { ref: x.token_no, on: x.filed_on }; }
      else if (r.purpose === 'TDS_DEPOSIT') { const ch = db.prepare("SELECT challans_json FROM tds_returns WHERE company_id = ? AND quarter = ?").all(c, quarterOf(r.periodEnd)).flatMap((x) => json(x.challans_json, [])).filter((x) => String(x.forMonth ?? x.date ?? '').slice(0, 7) === ym || String(x.date ?? '').slice(0, 7) === addMonths(ym, 1)); if (ch.length) done = { ref: ch.map((x) => x.serial ?? x.bsr).join(', '), on: ch[0].date }; }
      const left = daysBetween(today, r.dueDate); const status = done ? 'DONE' : left < 0 ? 'OVERDUE' : left <= r.alertDays ? 'DUE_SOON' : 'UPCOMING';
      return { ...r, status, daysLeft: left, done };
    }).filter((r) => r.purpose !== 'SALARY_RETURN' && r.purpose !== 'SALARY_CERT');
    return { from: f, to: t, today, rows, counts: { overdue: rows.filter((r) => r.status === 'OVERDUE').length, dueSoon: rows.filter((r) => r.status === 'DUE_SOON').length, done: rows.filter((r) => r.status === 'DONE').length, upcoming: rows.filter((r) => r.status === 'UPCOMING').length } };
  }
  const jobs = {
    /** Every morning: follow-ups due today and obligations within their alert days are told to the accounts manager. */
    daily() { let n = 0; for (const co of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: co.id, user: 'system', roles: [] }, 'ff.fin.p2308')) continue; const due = db.prepare("SELECT id, invoice_no, supplier_gstin, owner FROM gst_2b_lines WHERE company_id = ? AND resolution_status = 'FOLLOW_UP' AND next_followup <= ? AND deleted_at IS NULL").all(co.id, todayIST()); for (const l of due) { n += 1; notify(co.id, 'fin.gst_recon.alert', l.owner ? [`user:${l.owner}`] : ['permission:fin.gst_recon.manage'], l.invoice_no, 'follow-up due', `The follow-up of ${l.invoice_no} (${l.supplier_gstin}) is due today.`, `/finance/gst-reconciliation?line=${l.id}`, l.id); } } return { followups: n }; },
  };
  return { recon, reviews, returns, tds, tcs, calendar, jobs, parse2b, match };
}
