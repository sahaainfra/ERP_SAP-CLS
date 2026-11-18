import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid, same } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.06: cash and bank. A company bank account (23.04) gets its profile (current, cash credit, overdraft, escrow, deposit; the company, a branch or a project;
// its opening balance). A bank statement is imported (CSV or MT940; a line seen before is not taken twice) and matched to what the books say went through the account:
// the payments (23.04), the receipts (23.05), the transfers and the imprest replenishments of this part — by the UTR or reference, the cheque number, or the amount
// within a few days when only one entry fits; a payment matched by its UTR is confirmed in 23.04. A line nobody booked is posted (bank charges, interest) or set aside.
// The reconciliation statement (BRS) explains the difference between the books and the bank and is signed off by the accounts manager. A site imprest or petty cash
// is held by a custodian up to a limit: vouchers with their bill photo and cost allocation (BR-01: never more than the cash in hand; above ₹10,000 approved by the
// construction manager), replenished from the bank for the approved vouchers (site accountant → project manager → accounts manager), counted. Cash deposited, withdrawn
// or moved between banks is a contra entry approved by the accounts manager. The daily position shows every bank and cash balance.

export const VOUCHER_DOC = 'FIN_IMPREST_VOUCHER';
export const REPL_DOC = 'FIN_IMPREST_REPL';
export const CONTRA_DOC = 'FIN_CONTRA';
export const CATEGORIES = { MATERIAL: 'Small materials', TRANSPORT: 'Transport and freight', FOOD: 'Food and refreshments', REPAIRS: 'Repairs', SITE_EXPENSE: 'Site expenses', TRAVEL: 'Travel', POSTAGE: 'Postage and courier', OTHER: 'Other' };
export const ACCOUNT_KINDS = { CURRENT: 'Current account', CASH_CREDIT: 'Cash credit', OVERDRAFT: 'Overdraft', ESCROW: 'Escrow', DEPOSIT: 'Deposit' };
export const CONTRA_KINDS = { DEPOSIT: 'Cash deposited in the bank', WITHDRAWAL: 'Cash withdrawn from the bank', TRANSFER: 'Transfer between bank accounts' };
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const money = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

for (const [key, dataType, def, description] of [
  ['fin.imprest.cm_limit', 'integer', 10000, 'Part 23.06 §9: an imprest voucher above this many rupees is approved by the construction manager; at or below it, it is approved by itself within the custodian\'s band.'],
  ['fin.imprest.photo_above', 'integer', 500, 'Part 23.06 FR-03: an imprest voucher above this many rupees is sent only with a photo of its bill.'],
  ['fin.recon.date_window_days', 'integer', 3, 'Part 23.06 FR-02: a statement line is matched by its amount alone when exactly one entry of the books of that amount is within this many days of it.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

// ---- statement files ----
const toIso = (d) => {
  const s = String(d ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{2,4})$/.exec(s); if (m) { const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(m[2].toUpperCase()) + 1; if (mon) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
const amt = (v) => { const s = String(v ?? '').replace(/[,₹\s]/g, '').replace(/^\((.*)\)$/, '-$1'); if (!s || s === '-') return 0; const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const splitCsv = (line) => { const out = []; let cur = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
/** A CSV statement: the header names the columns (date, value date, narration, reference or cheque, debit or withdrawal, credit or deposit, balance). */
export function parseCsvStatement(text) {
  const rows = String(text ?? '').split(/\r?\n/).filter((l) => l.trim()).map(splitCsv);
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /debit|withdraw|credit|deposit|amount/i.test(c)));
  if (hi < 0) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'The file has no header row with the date and the debit and credit columns.' }]);
  const h = rows[hi].map((c) => c.toLowerCase());
  const col = (...re) => h.findIndex((c) => re.some((r) => r.test(c)));
  const iDate = col(/^(txn|tran|transaction)?\s*date$/, /^date$/, /posting date/); const iVal = col(/value/); const iDesc = col(/narration|description|particular|remark/); const iRef = col(/ref|utr/); const iChq = col(/cheque|chq/);
  const iDr = col(/debit|withdraw/); const iCr = col(/credit|deposit/); const iBal = col(/balance/);
  if (iDate < 0 || (iDr < 0 && iCr < 0)) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'The date, debit and credit columns could not be found.' }]);
  const lines = []; const problems = [];
  rows.slice(hi + 1).forEach((r, k) => {
    const d = toIso(r[iDate]); if (!d) { if (r.join('').trim()) problems.push(`Row ${hi + k + 2}: "${r[iDate] ?? ''}" is not a date.`); return; }
    const dr = iDr >= 0 ? amt(r[iDr]) : 0; const cr = iCr >= 0 ? amt(r[iCr]) : 0;
    if (Number.isNaN(dr) || Number.isNaN(cr)) { problems.push(`Row ${hi + k + 2}: the amount is not a number.`); return; }
    if (!dr && !cr) return;
    lines.push({ txnDate: d, valueDate: iVal >= 0 ? toIso(r[iVal]) : null, description: iDesc >= 0 ? r[iDesc] : '', ref: iRef >= 0 ? (r[iRef] || null) : null, chequeNo: iChq >= 0 ? (r[iChq] || null) : null, debit: Math.abs(dr), credit: Math.abs(cr), balance: iBal >= 0 && r[iBal] ? amt(r[iBal]) : null });
  });
  if (problems.length) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: problems.slice(0, 5).join(' ') }]);
  return { lines, opening: null, closing: lines.length && lines.at(-1).balance != null ? lines.at(-1).balance : null, account: null };
}
/** An MT940 statement (SWIFT): :25: the account, :60F: the opening, :61: each line, :86: its narration, :62F: the closing. */
export function parseMt940(text) {
  const t = String(text ?? '').replace(/\r/g, ''); const lines = []; let opening = null; let closing = null; let account = null; let last = null;
  const bal = (s) => { const m = /^([CD])(\d{6})[A-Z]{3}([\d,]+)/.exec(s); return m ? (m[1] === 'D' ? -1 : 1) * Math.round(Number(m[3].replace(',', '.')) * 100) : null; };
  for (const tag of t.split(/\n(?=:\d{2}[A-Z]?:)/)) {
    const m = /^:(\d{2}[A-Z]?):([\s\S]*)$/.exec(tag.trim()); if (!m) continue; const [, k, v] = m;
    if (k === '25') account = v.trim();
    else if (k === '60F' || k === '60M') opening = bal(v.trim());
    else if (k === '62F' || k === '62M') closing = bal(v.trim());
    else if (k === '61') {
      const x = /^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])[A-Z]?([\d,]+)N[A-Z0-9]{3}([^/\n]*)(?:\/\/([^\n]*))?/.exec(v.trim());
      if (!x) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: `An MT940 line could not be read: ${v.trim().slice(0, 60)}` }]);
      const date = `20${x[1]}-${x[2]}-${x[3]}`; const amount = Math.round(Number(x[6].replace(',', '.')) * 100); const debit = x[5].endsWith('D');
      last = { txnDate: x[4] ? `20${x[1]}-${x[4].slice(0, 2)}-${x[4].slice(2)}` : date, valueDate: date, description: '', ref: (x[7] || '').trim() || null, chequeNo: null, debit: debit ? amount : 0, credit: debit ? 0 : amount, balance: null, bankRef: x[8]?.trim() ?? null };
      lines.push(last);
    } else if (k === '86' && last) last.description = v.replace(/\n/g, ' ').trim();
  }
  if (!lines.length) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'The MT940 file has no :61: lines.' }]);
  let b = opening; if (b != null) for (const l of lines) { b += l.credit - l.debit; l.balance = b; }
  return { lines, opening, closing: closing ?? b, account };
}

/** @param {{ db: any, base: any, gl: any, flags?: any, payments?: () => any }} o */
export function createCashService({ db, base, gl, payments }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };
  const bankRow = (companyId, id) => db.prepare('SELECT * FROM fin_bank_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), companyId);
  const profileOf = (bankId) => db.prepare('SELECT * FROM fin_bank_account_profiles WHERE bank_account_id = ? AND deleted_at IS NULL').get(bankId);
  /** The project (or cost code) on a line of an account that may not carry one (its dimension rule, 06.05) is left off. */
  const dimFor = (accountId, dim, val) => (!val || db.prepare('SELECT 1 FROM fin_dimension_rules WHERE account_id = ? AND dimension = ? AND requirement = \'NOT_ALLOWED\' AND deleted_at IS NULL').get(accountId, dim) ? {} : { [dim === 'PROJECT' ? 'projectId' : dim === 'SITE' ? 'siteId' : 'costCodeId']: val });

  // ---- FR-01: the profile of a bank account ----
  const profiles = {
    get(actor, bankId) { need(actor, 'fin.bank.view', 'see bank accounts'); const b = bankRow(actor.companyId, bankId); if (!b) throw notFound('That bank account does not exist.'); const p = profileOf(b.id); return { bankAccountId: b.id, kind: p?.account_kind ?? 'CURRENT', kindLabel: ACCOUNT_KINDS[p?.account_kind ?? 'CURRENT'], scope: p?.scope_kind ?? 'COMPANY', branchId: p?.branch_id ?? null, projectId: p?.org_project_id ?? null, escrowPurpose: p?.escrow_purpose ?? null, odLimit: rs(p?.od_limit_paise ?? 0), openingDate: p?.opening_date ?? null, opening: rs(p?.opening_paise ?? 0), version: p?.version ?? 0 }; },
    save(actor, bankId, v) {
      need(actor, 'fin.bank.manage', 'set up bank accounts'); const b = bankRow(actor.companyId, bankId); if (!b) throw notFound('That bank account does not exist.');
      const problems = [];
      if (v.scope === 'PROJECT' && !(v.projectId && db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(v.projectId), actor.companyId))) problems.push({ field: 'projectId', message: 'Choose the project the account is kept for.' });
      if (v.scope === 'BRANCH' && !(v.branchId && db.prepare('SELECT 1 FROM org_branches WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(v.branchId), actor.companyId))) problems.push({ field: 'branchId', message: 'Choose the branch.' });
      if (v.kind === 'ESCROW' && !v.escrowPurpose) problems.push({ field: 'escrowPurpose', message: 'Say what the escrow is for (e.g. RERA collections of a project).' });
      if (['CASH_CREDIT', 'OVERDRAFT'].includes(v.kind) && !(Number(v.odLimit) > 0)) problems.push({ field: 'odLimit', message: 'Give the sanctioned limit.' });
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      const old = profileOf(b.id);
      return transaction(db, () => {
        if (old) db.prepare('UPDATE fin_bank_account_profiles SET account_kind = ?, scope_kind = ?, branch_id = ?, org_project_id = ?, escrow_purpose = ?, od_limit_paise = ?, opening_date = ?, opening_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.kind, v.scope, v.scope === 'BRANCH' ? Number(v.branchId) : null, v.scope === 'PROJECT' ? Number(v.projectId) : null, v.escrowPurpose ?? null, paise(v.odLimit ?? 0), v.openingDate ?? null, paise(v.opening ?? 0), actor.user, nowIso(), old.id);
        else db.prepare('INSERT INTO fin_bank_account_profiles (company_id, bank_account_id, account_kind, scope_kind, branch_id, org_project_id, escrow_purpose, od_limit_paise, opening_date, opening_paise, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, b.id, v.kind, v.scope, v.scope === 'BRANCH' ? Number(v.branchId) : null, v.scope === 'PROJECT' ? Number(v.projectId) : null, v.escrowPurpose ?? null, paise(v.odLimit ?? 0), v.openingDate ?? null, paise(v.opening ?? 0), actor.user, 'fin_bank_accounts');
        audit(actor, 'fin_bank_accounts', b.id, 'profile', actor.companyId, { oldValues: old ? { kind: old.account_kind, scope: old.scope_kind, opening: rs(old.opening_paise) } : null, newValues: { kind: v.kind, scope: v.scope, opening: v.opening ?? 0 } });
        return profiles.get(actor, b.id);
      });
    },
  };

  // ---- what the books say went through a bank account ----
  /** The entries of the books for a bank account: payments released (out), receipts posted (in), transfers, replenishments, statement lines posted as bank entries. */
  function bookItems(companyId, bankId, upTo = '9999-12-31') {
    const c = companyId; const items = [];
    for (const p of db.prepare("SELECT id, doc_no, released_on, amount_paise, utr, cheque_no, payee_name, pay_status FROM pmt_payments WHERE company_id = ? AND bank_account_id = ? AND pay_status IN ('PENDING', 'PAID') AND released_on <= ?").all(c, bankId, upTo)) items.push({ entity: 'pmt_payments', id: p.id, date: p.released_on, dir: 'OUT', amount: p.amount_paise, refs: [p.utr, p.doc_no, p.cheque_no].filter(Boolean), cheque: p.cheque_no, label: `${p.doc_no} ${p.payee_name}`, pending: p.pay_status === 'PENDING' });
    for (const r of db.prepare("SELECT r.id, r.doc_no, r.receipt_date, r.amount_paise, r.reference, p.legal_name FROM ar_receipts r JOIN mdm_partners p ON p.id = r.partner_id WHERE r.company_id = ? AND r.bank_account_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL AND r.receipt_date <= ?").all(c, bankId, upTo)) items.push({ entity: 'ar_receipts', id: r.id, date: r.receipt_date, dir: 'IN', amount: r.amount_paise, refs: [r.reference, r.doc_no].filter(Boolean), label: `${r.doc_no} ${r.legal_name}` });
    for (const k of db.prepare("SELECT * FROM fin_contras WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND (from_bank_id = ? OR to_bank_id = ?) AND contra_date <= ?").all(c, bankId, bankId, upTo)) items.push({ entity: 'fin_contras', id: k.id, date: k.contra_date, dir: k.from_bank_id === bankId ? 'OUT' : 'IN', amount: k.amount_paise, refs: [k.reference, k.doc_no].filter(Boolean), label: `${k.doc_no} ${CONTRA_KINDS[k.contra_kind]}` });
    for (const x of db.prepare("SELECT id, doc_no, paid_on, amount_paise FROM fin_imprest_replenishments WHERE company_id = ? AND bank_account_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND paid_on <= ?").all(c, bankId, upTo)) items.push({ entity: 'fin_imprest_replenishments', id: x.id, date: x.paid_on, dir: 'OUT', amount: x.amount_paise, refs: [x.doc_no], label: `${x.doc_no} imprest replenishment` });
    return items;
  }
  const matchedKeys = (bankId) => new Set(db.prepare("SELECT matched_entity, matched_id FROM fin_bank_statements WHERE bank_account_id = ? AND match_status IN ('AUTO', 'MANUAL') AND deleted_at IS NULL").all(bankId).map((x) => `${x.matched_entity}:${x.matched_id}`));
  const lineView = (l) => ({ id: l.id, importId: l.import_id, lineNo: l.line_no, date: l.txn_date, valueDate: l.value_date, description: l.description, ref: l.ref, chequeNo: l.cheque_no, debit: rs(l.debit_paise), credit: rs(l.credit_paise), balance: rs(l.balance_paise), status: l.match_status, entity: l.matched_entity, entityId: l.matched_id, rule: l.match_rule, matchedBy: l.matched_by, journalId: l.journal_id, ignoreReason: l.ignore_reason });

  /** Match a line to an entry of the books; a payment still pending at the bank is confirmed with the UTR (23.04). */
  function setMatch(actor, l, item, rule, status) {
    db.prepare('UPDATE fin_bank_statements SET match_status = ?, matched_entity = ?, matched_id = ?, match_rule = ?, matched_by = ?, matched_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, item.entity, item.id, rule, actor.user, nowIso(), actor.user, nowIso(), l.id);
    if (item.entity === 'pmt_payments' && item.pending && payments?.()) {
      const utr = [l.ref, ...String(l.description ?? '').split(/\s+/)].map(norm).find((x) => /^[A-Z0-9]{12,22}$/.test(x) && /\d/.test(x)) ?? null;
      try { payments().payments.confirm(actor, { rows: [{ paymentId: item.id, status: 'PAID', utr: item.cheque ? null : utr, paidOn: l.value_date ?? l.txn_date }] }); } catch { /* confirmed later by hand */ }
    }
    publishEvent(db, { type: 'fin.bank_line.matched', entity: 'fin_bank_statements', entityId: l.id, actorId: actor.user, companyId: l.company_id, data: { lineId: l.id, bankAccountId: l.bank_account_id, date: l.txn_date, debit: rs(l.debit_paise), credit: rs(l.credit_paise), entity: item.entity, entityId: item.id, rule } });
  }
  /** FR-02: the automatic match, in order: the UTR or reference, the cheque number, then the amount alone when one entry and one line fit within the days. */
  function autoMatch(actor, bankId) {
    const lines = db.prepare("SELECT * FROM fin_bank_statements WHERE bank_account_id = ? AND match_status = 'UNMATCHED' AND deleted_at IS NULL ORDER BY txn_date, id").all(bankId);
    const done = matchedKeys(bankId); let open = bookItems(lines[0]?.company_id ?? actor.companyId, bankId).filter((i) => !done.has(`${i.entity}:${i.id}`));
    const win = Number(param(actor.companyId, 'fin.recon.date_window_days') ?? 3); let n = 0;
    const take = (l, item, rule) => { setMatch(actor, l, item, rule, 'AUTO'); open = open.filter((i) => i !== item); n += 1; };
    const dirOf = (l) => (l.debit_paise > 0 ? 'OUT' : 'IN'); const amtOf = (l) => l.debit_paise || l.credit_paise;
    const i0 = (i) => Boolean(i.cheque) && i.refs.length && norm(i.refs.find((r) => norm(r).length >= 6 && norm(r) === norm(i.cheque)) ?? '') !== '';
    const left = [];
    for (const l of lines) {
      const text = norm(`${l.description} ${l.ref ?? ''}`); const same = open.filter((i) => i.dir === dirOf(l) && i.amount === amtOf(l));
      // a line with the bank's cheque number column is a cheque first
      const byChq = l.cheque_no ? same.find((i) => i.cheque && norm(i.cheque) === norm(l.cheque_no)) : null;
      if (byChq) { take(l, byChq, 'CHEQUE'); continue; }
      const byRef = same.find((i) => i.refs.some((r) => norm(r).length >= 6 && text.includes(norm(r))));
      if (byRef) { take(l, byRef, i0(byRef) ? 'CHEQUE' : 'REFERENCE'); continue; }
      left.push(l);
    }
    for (const l of left) {
      const near = (i) => i.dir === dirOf(l) && i.amount === amtOf(l) && Math.abs(Date.parse(i.date) - Date.parse(l.txn_date)) <= win * 86_400_000;
      const fits = open.filter(near); const rivals = left.filter((o) => o !== l && o.match_status === 'UNMATCHED' && amtOf(o) === amtOf(l) && dirOf(o) === dirOf(l) && fits.some((i) => Math.abs(Date.parse(i.date) - Date.parse(o.txn_date)) <= win * 86_400_000));
      if (fits.length === 1 && rivals.length === 0) { take(l, fits[0], 'AMOUNT_DATE'); l.match_status = 'AUTO'; }
    }
    return n;
  }

  const statements = {
    /** FR-02: import a statement: the lines read, those seen before left out, then matched automatically. */
    import(actor, { bankAccountId, fileName, format, content }) {
      need(actor, 'fin.bank_statement.import', 'import bank statements'); const b = bankRow(actor.companyId, bankAccountId); if (!b) throw notFound('That bank account does not exist.');
      const fmt = format ?? (/^:20:|\n:61:/.test(content) ? 'MT940' : 'CSV'); const parsed = fmt === 'MT940' ? parseMt940(content) : parseCsvStatement(content);
      if (parsed.account && !norm(parsed.account).endsWith(b.account_last4)) throw unprocessable(`The statement is of account ${parsed.account}, not of ${b.name} (••••${b.account_last4}).`);
      if (!parsed.lines.length) throw unprocessable('The statement has no lines.');
      return transaction(db, () => {
        const dates = parsed.lines.map((l) => l.txnDate).sort();
        const imp = Number(db.prepare('INSERT INTO fin_bank_statement_imports (company_id, doc_no, bank_account_id, file_name, file_format, from_date, to_date, opening_paise, closing_paise, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, docNo(actor.companyId, 'fin_bank_statement_imports', 'BST'), b.id, fileName, fmt, dates[0], dates.at(-1), parsed.opening, parsed.closing, actor.user, 'fin_bank_statement_imports').lastInsertRowid);
        const ins = db.prepare('INSERT OR IGNORE INTO fin_bank_statements (company_id, import_id, bank_account_id, line_no, txn_date, value_date, description, ref, cheque_no, debit_paise, credit_paise, balance_paise, line_hash, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        let added = 0; let dup = 0; const seen = new Map();
        parsed.lines.forEach((l, i) => {
          const base0 = `${l.txnDate}|${l.debit}|${l.credit}|${norm(l.ref)}|${norm(l.description)}|${l.balance ?? ''}`; const k = (seen.get(base0) ?? 0) + 1; seen.set(base0, k);
          const hash = createHash('sha256').update(`${base0}|${k}`).digest('hex');
          const r = ins.run(actor.companyId, imp, b.id, i + 1, l.txnDate, l.valueDate ?? null, String(l.description ?? '').slice(0, 500), l.ref ?? null, l.chequeNo ?? null, l.debit, l.credit, l.balance ?? null, hash, actor.user, 'fin_bank_statement_imports', String(imp));
          if (r.changes) added += 1; else dup += 1;
        });
        const matched = autoMatch(actor, b.id);
        db.prepare('UPDATE fin_bank_statement_imports SET lines_count = ?, duplicates_count = ?, matched_count = ? WHERE id = ?').run(added, dup, matched, imp);
        audit(actor, 'fin_bank_statement_imports', imp, 'import', actor.companyId, { newValues: { file: fileName, format: fmt, lines: added, duplicates: dup, matched } });
        return { importId: imp, lines: added, duplicates: dup, matched, unmatched: db.prepare("SELECT COUNT(*) AS n FROM fin_bank_statements WHERE import_id = ? AND match_status = 'UNMATCHED'").get(imp).n };
      });
    },
    /** The lines of a bank account (the worklist: the unmatched ones). */
    lines(actor, { bankAccountId, status, from, to }) {
      need(actor, 'fin.bank_statement.view', 'see bank statements'); const b = bankRow(actor.companyId, bankAccountId); if (!b) throw notFound('That bank account does not exist.');
      const rows = db.prepare(`SELECT * FROM fin_bank_statements WHERE bank_account_id = ? AND deleted_at IS NULL AND (? IS NULL OR match_status = ?) AND txn_date BETWEEN ? AND ? ORDER BY txn_date DESC, id DESC LIMIT 500`).all(b.id, status ?? null, status ?? null, from ?? '0000-01-01', to ?? '9999-12-31');
      const c = db.prepare("SELECT match_status AS s, COUNT(*) AS n FROM fin_bank_statements WHERE bank_account_id = ? AND deleted_at IS NULL GROUP BY match_status").all(b.id);
      const counts = Object.fromEntries(c.map((x) => [x.s, x.n])); const total = c.reduce((s, x) => s + x.n, 0); const auto = counts.AUTO ?? 0; const manual = (counts.MANUAL ?? 0) + (counts.POSTED ?? 0);
      return { bank: { id: b.id, name: b.name, account: `••••${b.account_last4}` }, rows: rows.map(lineView), counts, total, autoRate: total ? Math.round((auto / total) * 100) : null, reconciledRate: total ? Math.round(((auto + manual + (counts.IGNORED ?? 0)) / total) * 100) : null };
    },
    /** The entries of the books that could be this line: same direction, nearest amount and date first. */
    candidates(actor, lineId) {
      need(actor, 'fin.bank_statement.match', 'match bank statements'); const l = lineRow(actor, lineId); const done = matchedKeys(l.bank_account_id); const dir = l.debit_paise > 0 ? 'OUT' : 'IN'; const a = l.debit_paise || l.credit_paise;
      return bookItems(l.company_id, l.bank_account_id).filter((i) => i.dir === dir && !done.has(`${i.entity}:${i.id}`)).sort((x, y) => Math.abs(x.amount - a) - Math.abs(y.amount - a) || Math.abs(Date.parse(x.date) - Date.parse(l.txn_date)) - Math.abs(Date.parse(y.date) - Date.parse(l.txn_date))).slice(0, 20).map((i) => ({ entity: i.entity, id: i.id, date: i.date, amount: rs(i.amount), label: i.label, refs: i.refs }));
    },
    match(actor, lineId, { entity, id }) {
      need(actor, 'fin.bank_statement.match', 'match bank statements'); const l = lineRow(actor, lineId); if (l.match_status !== 'UNMATCHED') throw conflict('The line is matched or settled already.');
      const done = matchedKeys(l.bank_account_id); const item = bookItems(l.company_id, l.bank_account_id).find((i) => i.entity === entity && i.id === Number(id));
      if (!item || done.has(`${entity}:${id}`)) throw badRequest('Correct the highlighted fields', [{ field: 'id', message: 'Choose an entry of this bank account that is not matched yet.' }]);
      if (item.dir !== (l.debit_paise > 0 ? 'OUT' : 'IN') || item.amount !== (l.debit_paise || l.credit_paise)) throw badRequest('Correct the highlighted fields', [{ field: 'id', message: `The entry is ${money(item.amount)} ${item.dir === 'OUT' ? 'out' : 'in'}; the line is ${money(l.debit_paise || l.credit_paise)} ${l.debit_paise ? 'out' : 'in'}. Post the difference as its own entry.` }]);
      return transaction(db, () => { setMatch(actor, l, item, 'MANUAL', 'MANUAL'); audit(actor, 'fin_bank_statements', l.id, 'match', l.company_id, { newValues: { entity, id } }); return lineView(db.prepare('SELECT * FROM fin_bank_statements WHERE id = ?').get(l.id)); });
    },
    unmatch(actor, lineId, { reason }) {
      need(actor, 'fin.brs.sign', 'undo matches'); const l = lineRow(actor, lineId); if (!['AUTO', 'MANUAL', 'IGNORED'].includes(l.match_status)) throw conflict('Only a matched or set-aside line is undone; a posted one is reversed in the ledger.');
      if (db.prepare('SELECT 1 FROM fin_bank_recons WHERE bank_account_id = ? AND as_of >= ? AND deleted_at IS NULL').get(l.bank_account_id, l.txn_date)) throw conflict('A reconciliation signed off after this line covers it.');
      db.prepare("UPDATE fin_bank_statements SET match_status = 'UNMATCHED', matched_entity = NULL, matched_id = NULL, match_rule = NULL, matched_by = NULL, matched_at = NULL, ignore_reason = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), l.id);
      audit(actor, 'fin_bank_statements', l.id, 'unmatch', l.company_id, { reason, oldValues: { entity: l.matched_entity, id: l.matched_id } }); return lineView(db.prepare('SELECT * FROM fin_bank_statements WHERE id = ?').get(l.id));
    },
    /** A line nobody booked (bank charges, interest, a direct debit): posted to an account and settled. */
    post(actor, lineId, { accountId, narration, projectId, costCentreId }) {
      need(actor, 'fin.bank_statement.match', 'post bank entries'); const l = lineRow(actor, lineId); if (l.match_status !== 'UNMATCHED') throw conflict('The line is matched or settled already.');
      const b = bankRow(l.company_id, l.bank_account_id); const a = db.prepare("SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND account_status = 'ACTIVE' AND is_control = 0").get(Number(accountId), l.company_id);
      if (!a) throw badRequest('Correct the highlighted fields', [{ field: 'accountId', message: 'Choose the account (bank charges, interest received, …), not a control account.' }]);
      const v = rs(l.debit_paise || l.credit_paise); const dm = { ...(projectId ? { projectId: Number(projectId) } : {}), ...(costCentreId ? { costCentreId: Number(costCentreId) } : {}) };
      const chk = gl.checkLines(l.company_id, [{ accountId: a.id, debit: '1', ...dm }, { accountId: b.gl_account_id, credit: '1' }], { source: 'ENGINE' }); const bad = chk.problems.filter((x) => x.field.startsWith('lines.0.'));
      if (bad.length) throw badRequest('Correct the highlighted fields', bad.map((x) => ({ field: /project/i.test(x.field) ? 'projectId' : /costCentre/i.test(x.field) ? 'costCentreId' : 'accountId', message: x.message })));
      return transaction(db, () => {
        const j = gl.postEngine(l.company_id, { voucherType: l.debit_paise ? 'PV' : 'RV', date: l.txn_date, narration: `${narration} (bank statement ${l.txn_date}: ${l.description})`.slice(0, 500), sourceType: 'fin_bank_statements', sourceId: l.id, lines: l.debit_paise ? [{ accountId: a.id, debit: v, ...dm }, { accountId: b.gl_account_id, credit: v }] : [{ accountId: b.gl_account_id, debit: v }, { accountId: a.id, credit: v, ...dm }], user: actor.user });
        db.prepare("UPDATE fin_bank_statements SET match_status = 'POSTED', matched_entity = 'fin_journals', matched_id = ?, journal_id = ?, match_rule = 'POSTED', matched_by = ?, matched_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(j.journal.id, j.journal.id, actor.user, nowIso(), actor.user, nowIso(), l.id);
        audit(actor, 'fin_bank_statements', l.id, 'post', l.company_id, { newValues: { account: a.code, amount: v, journal: j.journal.id } }); return lineView(db.prepare('SELECT * FROM fin_bank_statements WHERE id = ?').get(l.id));
      });
    },
    ignore(actor, lineId, { reason }) { need(actor, 'fin.bank_statement.match', 'set lines aside'); const l = lineRow(actor, lineId); if (l.match_status !== 'UNMATCHED') throw conflict('The line is matched or settled already.'); db.prepare("UPDATE fin_bank_statements SET match_status = 'IGNORED', ignore_reason = ?, matched_by = ?, matched_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), actor.user, nowIso(), l.id); audit(actor, 'fin_bank_statements', l.id, 'ignore', l.company_id, { reason }); return lineView(db.prepare('SELECT * FROM fin_bank_statements WHERE id = ?').get(l.id)); },
    rematch(actor, { bankAccountId }) { need(actor, 'fin.bank_statement.match', 'match bank statements'); const b = bankRow(actor.companyId, bankAccountId); if (!b) throw notFound('That bank account does not exist.'); return { matched: transaction(db, () => autoMatch(actor, b.id)) }; },
  };
  const lineRow = (actor, id) => { const l = db.prepare('SELECT * FROM fin_bank_statements WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!l) throw notFound('That statement line does not exist.'); return l; };

  // ---- FR-02: the bank reconciliation statement ----
  /** The books against the bank on a date: the book balance, plus payments not yet through the bank, less receipts not yet credited, less and plus what only the bank has. */
  function brs(actor, { bankAccountId, asOf }) {
    need(actor, 'fin.brs.view', 'see reconciliations'); const b = bankRow(actor.companyId, bankAccountId); if (!b) throw notFound('That bank account does not exist.');
    const d = asOf ?? todayIST(); const p = profileOf(b.id); const start = p?.opening_date ?? '0000-01-01';
    const lines = db.prepare('SELECT * FROM fin_bank_statements WHERE bank_account_id = ? AND deleted_at IS NULL AND txn_date <= ? ORDER BY txn_date, import_id, line_no').all(b.id, d);
    const lastBal = [...lines].reverse().find((l) => l.balance_paise != null);
    const imp = db.prepare('SELECT * FROM fin_bank_statement_imports WHERE bank_account_id = ? AND deleted_at IS NULL AND to_date <= ? ORDER BY to_date DESC, id DESC LIMIT 1').get(b.id, d);
    const bank = lastBal?.balance_paise ?? imp?.closing_paise ?? null;
    const items = bookItems(b.company_id, b.id, d).filter((i) => i.date >= start);
    const posted = lines.filter((l) => l.match_status === 'POSTED');
    const book = (p?.opening_paise ?? 0) + items.reduce((s, i) => s + (i.dir === 'IN' ? i.amount : -i.amount), 0) + posted.reduce((s, l) => s + l.credit_paise - l.debit_paise, 0);
    const matchedBy = new Map(lines.filter((l) => ['AUTO', 'MANUAL'].includes(l.match_status)).map((l) => [`${l.matched_entity}:${l.matched_id}`, l]));
    const unpresented = items.filter((i) => i.dir === 'OUT' && !matchedBy.has(`${i.entity}:${i.id}`)); const uncredited = items.filter((i) => i.dir === 'IN' && !matchedBy.has(`${i.entity}:${i.id}`));
    const bankOnly = lines.filter((l) => ['UNMATCHED', 'IGNORED'].includes(l.match_status));
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const up = sum(unpresented, (i) => i.amount); const un = sum(uncredited, (i) => i.amount); const bDr = sum(bankOnly, (l) => l.debit_paise); const bCr = sum(bankOnly, (l) => l.credit_paise);
    const computed = book + up - un - bDr + bCr; const diff = bank == null ? null : bank - computed;
    const signed = db.prepare('SELECT * FROM fin_bank_recons WHERE bank_account_id = ? AND as_of = ? AND deleted_at IS NULL').get(b.id, d);
    return { bank: { id: b.id, name: b.name, account: `••••${b.account_last4}` }, asOf: d, book: rs(book), statement: rs(bank), unpresented: { total: rs(up), rows: unpresented.map((i) => ({ entity: i.entity, id: i.id, date: i.date, label: i.label, amount: rs(i.amount) })) }, uncredited: { total: rs(un), rows: uncredited.map((i) => ({ entity: i.entity, id: i.id, date: i.date, label: i.label, amount: rs(i.amount) })) },
      bankOnly: { debit: rs(bDr), credit: rs(bCr), rows: bankOnly.map(lineView) }, computed: rs(computed), difference: rs(diff), balanced: diff === 0, signed: signed ? { by: signed.signed_by, at: signed.signed_at } : null, can: { sign: may(actor, 'fin.brs.sign') && diff === 0 && !signed } };
  }
  function signBrs(actor, q) {
    need(actor, 'fin.brs.sign', 'sign off reconciliations'); const r = brs(actor, q);
    if (r.statement == null) throw unprocessable('No statement covers this date: import it first.');
    if (!r.balanced) throw unprocessable(`The reconciliation does not balance: ${money(paise(r.difference))} is not explained. Match, post or set aside the lines first.`);
    if (r.signed) throw conflict('This reconciliation is signed off already.');
    return transaction(db, () => {
      const id = Number(db.prepare('INSERT INTO fin_bank_recons (company_id, bank_account_id, as_of, book_paise, bank_paise, unpresented_paise, uncredited_paise, bank_only_dr_paise, bank_only_cr_paise, difference_paise, signed_by, signed_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)').run(actor.companyId, r.bank.id, r.asOf, paise(r.book), paise(r.statement), paise(r.unpresented.total), paise(r.uncredited.total), paise(r.bankOnly.debit), paise(r.bankOnly.credit), actor.user, nowIso(), actor.user, 'fin_bank_recons').lastInsertRowid);
      audit(actor, 'fin_bank_recons', id, 'sign', actor.companyId, { newValues: { bank: r.bank.name, asOf: r.asOf, book: r.book, statement: r.statement } });
      publishEvent(db, { type: 'fin.bank.reconciled', entity: 'fin_bank_recons', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { reconId: id, bankAccountId: r.bank.id, asOf: r.asOf, book: r.book, statement: r.statement } });
      return brs(actor, q);
    });
  }

  // ---- FR-03: imprests ----
  const impRow = (actor, id) => { const r = db.prepare('SELECT * FROM fin_imprests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That imprest does not exist.'); return r; };
  const holds = (actor, r) => same(r.custodian, actor.user) || may(actor, 'fin.imprest.manage');
  const pendingOf = (impId) => db.prepare("SELECT COALESCE(SUM(total_paise), 0) AS s FROM fin_imprest_vouchers WHERE imprest_id = ? AND status IN ('SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(impId).s;
  const unrepl = (impId) => db.prepare("SELECT COALESCE(SUM(total_paise), 0) AS s, COUNT(*) AS n FROM fin_imprest_vouchers WHERE imprest_id = ? AND status = 'APPROVED' AND replenishment_id IS NULL AND deleted_at IS NULL").get(impId);
  const impView = (actor, r) => { const u = unrepl(r.id); const lc = db.prepare('SELECT * FROM fin_cash_counts WHERE imprest_id = ? ORDER BY id DESC LIMIT 1').get(r.id); return { id: r.id, docNo: r.doc_no, name: r.name, kind: r.imprest_kind, projectId: r.org_project_id, siteId: r.org_site_id, custodian: r.custodian, limit: rs(r.limit_paise), balance: rs(r.balance_paise), pending: rs(pendingOf(r.id)), available: rs(r.balance_paise - pendingOf(r.id)), toReplenish: rs(u.s), vouchersToReplenish: u.n, status: r.imprest_status, lastCount: lc ? { date: lc.count_date, counted: rs(lc.counted_paise), difference: rs(lc.difference_paise) } : null, mine: same(r.custodian, actor.user), version: r.version }; };
  const imprests = {
    list(actor) {
      need(actor, 'fin.imprest.view', 'see imprests'); const f = authz.scopeFilter(actor, 'fin.imprest.view', { project: 'x.org_project_id', site: 'x.org_site_id' });
      return db.prepare(`SELECT x.* FROM fin_imprests x WHERE x.company_id = :c AND x.deleted_at IS NULL AND (x.custodian = :u OR ${f.sql}) ORDER BY (x.custodian = :u) DESC, x.name`).all({ c: actor.companyId, u: actor.user }).map((r) => impView(actor, r));
    },
    get(actor, id) { need(actor, 'fin.imprest.view', 'see imprests'); const r = impRow(actor, id); if (!same(r.custodian, actor.user) && !may(actor, 'fin.imprest.view', r.org_project_id, r.org_site_id)) throw notFound('That imprest does not exist.'); return { ...impView(actor, r), vouchers: db.prepare('SELECT * FROM fin_imprest_vouchers WHERE imprest_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100').all(r.id).map((v) => vView(actor, v)), replenishments: db.prepare('SELECT * FROM fin_imprest_replenishments WHERE imprest_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(r.id).map((x) => rView(actor, x)), counts: db.prepare('SELECT * FROM fin_cash_counts WHERE imprest_id = ? ORDER BY id DESC LIMIT 20').all(r.id).map((c) => ({ id: c.id, date: c.count_date, counted: rs(c.counted_paise), book: rs(c.book_paise), difference: rs(c.difference_paise), by: c.counted_by, witness: c.witness, note: c.note })) }; },
    create(actor, b) {
      need(actor, 'fin.imprest.manage', 'set up imprests'); const problems = [];
      if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(b.projectId), actor.companyId)) problems.push({ field: 'projectId', message: 'The project does not exist.' });
      if (b.siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(b.siteId), actor.companyId)) problems.push({ field: 'siteId', message: 'The site does not exist.' });
      if (!db.prepare("SELECT 1 FROM iam_users WHERE username = ? AND company_id = ? AND status = 'ACTIVE'").get(b.custodian, actor.companyId)) problems.push({ field: 'custodian', message: 'The custodian is a user of the company.' });
      if (db.prepare("SELECT 1 FROM fin_imprests WHERE company_id = ? AND custodian = ? AND COALESCE(org_site_id, 0) = ? AND imprest_status = 'ACTIVE' AND deleted_at IS NULL").get(actor.companyId, b.custodian, Number(b.siteId ?? 0))) problems.push({ field: 'custodian', message: 'The custodian already holds an imprest for this site.' });
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      const id = Number(db.prepare('INSERT INTO fin_imprests (company_id, doc_no, name, imprest_kind, org_project_id, org_site_id, custodian, gl_account_id, limit_paise, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, docNo(actor.companyId, 'fin_imprests', 'IMP'), b.name, b.kind ?? 'SITE', b.projectId ?? null, b.siteId ?? null, b.custodian, acct(actor.companyId, '150001'), paise(b.limit), actor.user, 'fin_imprests').lastInsertRowid);
      audit(actor, 'fin_imprests', id, 'create', actor.companyId, { newValues: { name: b.name, custodian: b.custodian, limit: b.limit } }); return imprests.get(actor, id);
    },
    /** FR-03: a count of the cash in hand against the book; a difference is reported to the accounts manager. */
    count(actor, id, { denominations, witness, note }) {
      const r = impRow(actor, id); if (!holds(actor, r) && !may(actor, 'fin.imprest.count')) throw forbidden('The custodian or the accounts manager counts the cash.');
      const counted = Object.entries(denominations ?? {}).reduce((s, [d, n]) => s + Math.round(Number(d) * 100) * Number(n), 0); const diff = counted - r.balance_paise;
      return transaction(db, () => {
        db.prepare('INSERT INTO fin_cash_counts (company_id, imprest_id, count_date, denominations_json, counted_paise, book_paise, difference_paise, counted_by, witness, note, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, r.id, todayIST(), JSON.stringify(denominations ?? {}), counted, r.balance_paise, diff, actor.user, witness ?? null, note ?? null, r.org_project_id, r.org_site_id, actor.user, 'fin_imprests');
        db.prepare('UPDATE fin_imprests SET last_count_at = ? WHERE id = ?').run(nowIso(), r.id);
        audit(actor, 'fin_imprests', r.id, 'cash_count', r.company_id, { newValues: { counted: rs(counted), book: rs(r.balance_paise), difference: rs(diff) } });
        if (diff !== 0) notify(r.company_id, 'fin.cash.alert', ['permission:fin.imprest.manage'], r.doc_no, 'cash count difference', `The cash of ${r.name} (${r.custodian}) counted ${money(counted)} against ${money(r.balance_paise)} in the book: ${diff > 0 ? 'excess' : 'shortage'} of ${money(Math.abs(diff))}.`, `/finance/imprest?id=${r.id}`, r.id);
        return imprests.get(actor, r.id);
      });
    },
  };

  // ---- imprest vouchers (BR-01; above the limit the construction manager approves) ----
  const postVoucher = (actor, v) => {
    const imp = db.prepare('SELECT * FROM fin_imprests WHERE id = ?').get(v.imprest_id); if (imp.balance_paise < v.total_paise) throw unprocessable(`BR-01: the imprest has ${money(imp.balance_paise)} in hand; the voucher is ${money(v.total_paise)}.`);
    const half = Math.round(v.gst_paise / 2);
    const lines = [{ accountId: v.expense_account_id, debit: rs(v.amount_paise), ...dimFor(v.expense_account_id, 'PROJECT', v.org_project_id), ...dimFor(v.expense_account_id, 'SITE', v.org_site_id), ...dimFor(v.expense_account_id, 'COST_CODE', v.cost_code_id) },
      ...(v.gst_paise ? [{ accountId: acct(v.company_id, '170001'), debit: rs(half) }, { accountId: acct(v.company_id, '170002'), debit: rs(v.gst_paise - half) }] : []), { accountId: imp.gl_account_id, credit: rs(v.total_paise), ...dimFor(imp.gl_account_id, 'PROJECT', imp.org_project_id) }];
    const j = gl.postEngine(v.company_id, { voucherType: 'PV', date: v.voucher_date, narration: `Imprest ${imp.name}: ${v.payee}, ${v.description}`.slice(0, 500), sourceType: 'fin_imprest_vouchers', sourceId: v.id, lines, user: actor.user });
    db.prepare('UPDATE fin_imprest_vouchers SET journal_id = ? WHERE id = ?').run(j.journal.id, v.id);
    db.prepare('UPDATE fin_imprests SET balance_paise = balance_paise - ?, version = version + 1 WHERE id = ?').run(v.total_paise, imp.id);
    publishEvent(db, { type: 'fin.imprest_voucher.approved', entity: 'fin_imprest_vouchers', entityId: v.id, actorId: actor.user, companyId: v.company_id, data: { voucherId: v.id, docNo: v.doc_no, imprestId: imp.id, projectId: v.org_project_id, siteId: v.org_site_id, costCodeId: v.cost_code_id, category: v.category, amount: rs(v.amount_paise), gst: rs(v.gst_paise), total: rs(v.total_paise) } });
  };
  const vFlow = createFlow({
    db, base, docType: VOUCHER_DOC, table: 'fin_imprest_vouchers', perm: 'fin.imprest_voucher', label: 'imprest voucher', route: '/finance/imprest?voucher=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: r.org_site_id ?? null }), ctx: (r) => ({ total: rs(r.total_paise) }), title: (r) => `${r.payee} ${money(r.total_paise)} ${r.description}`, notifyCode: 'fin.cash.decided', numberKey: 'FIN_IMPREST_VOUCHER', prefix: 'IV',
    beforeSubmit: (_a, r) => voucherChecks(r),
    onApproved: (actor, r) => postVoucher(actor, db.prepare('SELECT * FROM fin_imprest_vouchers WHERE id = ?').get(r.id)),
  });
  function voucherChecks(r) {
    const imp = db.prepare('SELECT * FROM fin_imprests WHERE id = ?').get(r.imprest_id); const avail = imp.balance_paise - pendingOf(imp.id) + (['SUBMITTED', 'RETURNED'].includes(r.status) ? r.total_paise : 0);
    if (r.total_paise > avail) throw unprocessable(`BR-01: the voucher (${money(r.total_paise)}) is more than the cash in hand not yet spoken for (${money(Math.max(0, avail))}). Ask for a replenishment.`);
    if (r.total_paise > Number(param(r.company_id, 'fin.imprest.photo_above') ?? 500) * 100 && !db.prepare("SELECT 1 FROM core_files WHERE linked_entity = 'fin_imprest_vouchers' AND linked_id = ? AND deleted_at IS NULL").get(r.id)) throw unprocessable(`A voucher above ₹${param(r.company_id, 'fin.imprest.photo_above') ?? 500} is sent with the photo of its bill. Add the photo.`);
  }
  const vView = (actor, v, detail = false) => ({ id: v.id, docNo: v.doc_no, imprestId: v.imprest_id, date: v.voucher_date, payee: v.payee, category: v.category, categoryLabel: CATEGORIES[v.category], description: v.description, amount: rs(v.amount_paise), gst: rs(v.gst_paise), total: rs(v.total_paise), expenseAccountId: v.expense_account_id, costCodeId: v.cost_code_id, projectId: v.org_project_id, siteId: v.org_site_id, replenishmentId: v.replenishment_id, status: v.status, statusLabel: STATUS[v.status], journalId: v.journal_id, version: v.version,
    photos: db.prepare("SELECT id, original_name FROM core_files WHERE linked_entity = 'fin_imprest_vouchers' AND linked_id = ? AND deleted_at IS NULL").all(v.id).map((f) => ({ id: f.id, name: f.original_name })), can: vFlow.can(actor, v), ...(detail ? vFlow.approveInfo(actor, v) : {}) });
  function voucherValues(actor, b) {
    const imp = impRow(actor, b.imprestId); const problems = [];
    if (!holds(actor, imp)) throw forbidden('Vouchers of an imprest are entered by its custodian.');
    if (imp.imprest_status !== 'ACTIVE') problems.push({ field: 'imprestId', message: 'The imprest is closed.' });
    const ea = db.prepare("SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND account_status = 'ACTIVE' AND is_control = 0").get(Number(b.expenseAccountId), actor.companyId);
    if (!ea) problems.push({ field: 'expenseAccountId', message: 'Choose the expense head (not a control account).' });
    if (b.costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(Number(b.costCodeId), actor.companyId)) problems.push({ field: 'costCodeId', message: 'The cost code does not exist.' });
    if (b.date > todayIST()) problems.push({ field: 'date', message: 'A voucher is dated today or before.' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    const pj = b.projectId ?? imp.org_project_id ?? null; const st = b.siteId ?? imp.org_site_id ?? null;
    const chk = gl.checkLines(actor.companyId, [{ accountId: ea.id, debit: '1', ...dimFor(ea.id, 'PROJECT', pj), ...dimFor(ea.id, 'SITE', st), ...dimFor(ea.id, 'COST_CODE', b.costCodeId ? Number(b.costCodeId) : null) }, { accountId: imp.gl_account_id, credit: '1', ...dimFor(imp.gl_account_id, 'PROJECT', imp.org_project_id) }], { source: 'ENGINE' });
    const bad = chk.problems.filter((x) => x.field.startsWith('lines.0.')); if (bad.length) throw badRequest('Correct the highlighted fields', bad.map((x) => ({ field: /costCode/.test(x.field) ? 'costCodeId' : /project|site/i.test(x.field) ? 'projectId' : 'expenseAccountId', message: x.message })));
    const amount = paise(b.amount); const gst = paise(b.gst ?? 0);
    if (amount + gst > imp.balance_paise - pendingOf(imp.id)) throw badRequest('Correct the highlighted fields', [{ field: 'amount', message: `BR-01: ${money(Math.max(0, imp.balance_paise - pendingOf(imp.id)))} of the imprest is in hand and not spoken for.` }]);
    return { imp, ea, amount, gst, pj, st };
  }
  const vouchers = {
    flow: vFlow,
    get(actor, id) { return vView(actor, vFlow.row(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.imprest_voucher.create', 'enter imprest vouchers');
      if (b.clientRef) { const ex = db.prepare('SELECT * FROM fin_imprest_vouchers WHERE company_id = ? AND client_ref = ?').get(actor.companyId, b.clientRef); if (ex) return vView(actor, ex); }
      const v = voucherValues(actor, b);
      return transaction(db, () => {
        const id = Number(db.prepare('INSERT INTO fin_imprest_vouchers (company_id, doc_no, imprest_id, voucher_date, payee, category, description, amount_paise, gst_paise, total_paise, expense_account_id, cost_code_id, org_project_id, org_site_id, client_ref, lat, lng, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(actor.companyId, docNo(actor.companyId, 'fin_imprest_vouchers', 'IV'), v.imp.id, b.date, b.payee, b.category, b.description, v.amount, v.gst, v.amount + v.gst, v.ea.id, b.costCodeId ? Number(b.costCodeId) : null, v.pj, v.st, b.clientRef ?? null, b.lat ?? null, b.lng ?? null, actor.user, actor.user, 'fin_imprests').lastInsertRowid);
        audit(actor, 'fin_imprest_vouchers', id, 'create', actor.companyId, { newValues: { total: rs(v.amount + v.gst), payee: b.payee } });
        return vView(actor, db.prepare('SELECT * FROM fin_imprest_vouchers WHERE id = ?').get(id));
      });
    },
    /** Sent: at or below the construction manager's limit it is approved within the custodian's band and posted at once; above it, the workflow. */
    submit(actor, id) {
      const r = vFlow.row(actor, id, 'fin.imprest_voucher.submit'); need(actor, 'fin.imprest_voucher.submit', 'send imprest vouchers'); if (!vFlow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned voucher is sent.');
      if (r.total_paise > Number(param(r.company_id, 'fin.imprest.cm_limit') ?? 10000) * 100) { vFlow.submit(actor, id); return vouchers.get(actor, id); }
      voucherChecks(r);
      return transaction(db, () => { db.prepare("UPDATE fin_imprest_vouchers SET status = 'APPROVED', requested_by = ?, approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, 'within band', nowIso(), actor.user, nowIso(), r.id); audit(actor, 'fin_imprest_vouchers', r.id, 'approve', r.company_id, { reason: 'Within the custodian\'s band' }); postVoucher(actor, db.prepare('SELECT * FROM fin_imprest_vouchers WHERE id = ?').get(r.id)); return vouchers.get(actor, id); });
    },
    update(actor, id, b) {
      const r = vFlow.row(actor, id, 'fin.imprest_voucher.edit'); need(actor, 'fin.imprest_voucher.edit', 'change imprest vouchers'); if (!vFlow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned voucher is changed.'); if (b.version !== r.version) throw conflict('The voucher was changed by someone else; reload it.');
      const v = voucherValues(actor, { ...b, imprestId: r.imprest_id });
      db.prepare('UPDATE fin_imprest_vouchers SET voucher_date = ?, payee = ?, category = ?, description = ?, amount_paise = ?, gst_paise = ?, total_paise = ?, expense_account_id = ?, cost_code_id = ?, org_project_id = ?, org_site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.date, b.payee, b.category, b.description, v.amount, v.gst, v.amount + v.gst, v.ea.id, b.costCodeId ? Number(b.costCodeId) : null, v.pj, v.st, actor.user, nowIso(), r.id);
      audit(actor, 'fin_imprest_vouchers', r.id, 'update', actor.companyId); return vouchers.get(actor, r.id);
    },
    remove(actor, id) { return vFlow.remove(actor, id); },
    withdraw(actor, id, b) { vFlow.withdraw(actor, id, b); return vouchers.get(actor, id); },
    cancel(actor, id, b) { vFlow.cancel(actor, id, b); return vouchers.get(actor, id); },
    history(actor, id) { return vFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return vFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- replenishments (site accountant → project manager → accounts manager): only approved vouchers (BR-01) ----
  const rFlow = createFlow({
    db, base, docType: REPL_DOC, table: 'fin_imprest_replenishments', perm: 'fin.imprest_replenishment', label: 'imprest replenishment', route: '/finance/imprest?replenishment=',
    where: (r) => ({ pid: r.org_project_id ?? null, sid: r.org_site_id ?? null }), ctx: (r) => ({ total: rs(r.amount_paise) }), title: (r) => `${r.vouchers_count} voucher(s) ${money(r.amount_paise)}`, notifyCode: 'fin.cash.decided', numberKey: 'FIN_IMPREST_REPL', prefix: 'IR',
    beforeSubmit: (_a, r) => { const ids = json(r.vouchers_json, []); const bad = db.prepare(`SELECT COUNT(*) AS n FROM fin_imprest_vouchers WHERE id IN (${ids.map(() => '?').join(',') || '0'}) AND (status != 'APPROVED' OR replenishment_id != ?)`).get(...ids, r.id).n; if (bad) throw unprocessable('BR-01: a replenishment carries approved vouchers only.'); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM fin_imprest_replenishments WHERE id = ?').get(r.id); const imp = db.prepare('SELECT * FROM fin_imprests WHERE id = ?').get(x.imprest_id); const b = db.prepare('SELECT * FROM fin_bank_accounts WHERE id = ?').get(x.bank_account_id);
      const j = gl.postEngine(x.company_id, { voucherType: 'CV', date: todayIST(), narration: `Imprest ${imp.name} replenished: ${x.vouchers_count} voucher(s)`, sourceType: 'fin_imprest_replenishments', sourceId: x.id, lines: [{ accountId: imp.gl_account_id, debit: rs(x.amount_paise), ...dimFor(imp.gl_account_id, 'PROJECT', imp.org_project_id) }, { accountId: b.gl_account_id, credit: rs(x.amount_paise) }], user: actor.user });
      db.prepare('UPDATE fin_imprest_replenishments SET journal_id = ?, paid_on = ? WHERE id = ?').run(j.journal.id, todayIST(), x.id);
      db.prepare('UPDATE fin_imprests SET balance_paise = balance_paise + ?, version = version + 1 WHERE id = ?').run(x.amount_paise, imp.id);
      publishEvent(db, { type: 'fin.imprest.replenished', entity: 'fin_imprest_replenishments', entityId: x.id, actorId: actor.user, companyId: x.company_id, data: { replenishmentId: x.id, docNo: x.doc_no, imprestId: imp.id, bankAccountId: b.id, amount: rs(x.amount_paise), journalId: j.journal.id } });
    },
    onOutcome: (_actor, r, status) => { if (['REJECTED', 'CANCELLED'].includes(status)) db.prepare('UPDATE fin_imprest_vouchers SET replenishment_id = NULL, version = version + 1 WHERE replenishment_id = ?').run(r.id); },
  });
  const rView = (actor, x, detail = false) => ({ id: x.id, docNo: x.doc_no, imprestId: x.imprest_id, amount: rs(x.amount_paise), vouchers: x.vouchers_count, voucherIds: json(x.vouchers_json, []), bankAccountId: x.bank_account_id, paidOn: x.paid_on, status: x.status, statusLabel: STATUS[x.status], journalId: x.journal_id, can: rFlow.can(actor, x), ...(detail ? rFlow.approveInfo(actor, x) : {}) });
  const replenishments = {
    flow: rFlow,
    get(actor, id) { return rView(actor, rFlow.row(actor, id), true); },
    list(actor, /** @type {{ status?: string }} */ { status } = {}) { need(actor, 'fin.imprest_replenishment.view', 'see replenishments'); const f = authz.scopeFilter(actor, 'fin.imprest_replenishment.view', { project: 'x.org_project_id', site: 'x.org_site_id' }); return db.prepare(`SELECT x.* FROM fin_imprest_replenishments x WHERE x.company_id = :c AND x.deleted_at IS NULL AND ${f.sql} AND (:s IS NULL OR x.status = :s) ORDER BY x.id DESC LIMIT 200`).all({ c: actor.companyId, s: status ?? null }).map((x) => rView(actor, x)); },
    /** The approved vouchers not yet paid back, in one request (sent at once). */
    create(actor, { imprestId, bankAccountId }) {
      need(actor, 'fin.imprest_replenishment.create', 'ask for replenishments'); const imp = impRow(actor, imprestId); if (!holds(actor, imp)) throw forbidden('The custodian asks for the replenishment of an imprest.');
      const b = bankRow(actor.companyId, bankAccountId); if (!b || b.acct_status !== 'ACTIVE') throw badRequest('Correct the highlighted fields', [{ field: 'bankAccountId', message: 'Choose the bank account the cash comes from.' }]);
      const vs = db.prepare("SELECT id, total_paise FROM fin_imprest_vouchers WHERE imprest_id = ? AND status = 'APPROVED' AND replenishment_id IS NULL AND deleted_at IS NULL ORDER BY id").all(imp.id);
      if (!vs.length) throw unprocessable('BR-01: there are no approved vouchers to replenish.');
      const amount = vs.reduce((s, v) => s + v.total_paise, 0);
      return transaction(db, () => {
        const id = Number(db.prepare('INSERT INTO fin_imprest_replenishments (company_id, doc_no, imprest_id, org_project_id, org_site_id, bank_account_id, vouchers_json, vouchers_count, amount_paise, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, docNo(actor.companyId, 'fin_imprest_replenishments', 'IR'), imp.id, imp.org_project_id, imp.org_site_id, b.id, JSON.stringify(vs.map((v) => v.id)), vs.length, amount, actor.user, actor.user, 'fin_imprests').lastInsertRowid);
        db.prepare(`UPDATE fin_imprest_vouchers SET replenishment_id = ?, version = version + 1 WHERE id IN (${vs.map(() => '?').join(',')})`).run(id, ...vs.map((v) => v.id));
        audit(actor, 'fin_imprest_replenishments', id, 'create', actor.companyId, { newValues: { vouchers: vs.length, amount: rs(amount) } });
        rFlow.submit(actor, id); return replenishments.get(actor, id);
      });
    },
    withdraw(actor, id, b) { rFlow.withdraw(actor, id, b); return replenishments.get(actor, id); },
    cancel(actor, id, b) { rFlow.cancel(actor, id, b); return replenishments.get(actor, id); },
    history(actor, id) { return rFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return rFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-04: contra entries (approved by the accounts manager) ----
  const kFlow = createFlow({
    db, base, docType: CONTRA_DOC, table: 'fin_contras', perm: 'fin.contra', label: 'contra entry', route: '/finance/cash-position?contra=',
    where: () => ({ pid: null, sid: null }), ctx: (r) => ({ total: rs(r.amount_paise) }), title: (r) => `${CONTRA_KINDS[r.contra_kind]} ${money(r.amount_paise)}`, notifyCode: 'fin.cash.decided', numberKey: 'FIN_CONTRA', prefix: 'CT',
    beforeSubmit: (_a, r) => contraChecks(r),
    onApproved: (actor, r) => {
      const k = db.prepare('SELECT * FROM fin_contras WHERE id = ?').get(r.id); contraChecks(k);
      const side = (bankId, impId) => (bankId ? { accountId: db.prepare('SELECT gl_account_id FROM fin_bank_accounts WHERE id = ?').get(bankId).gl_account_id } : (() => { const i = db.prepare('SELECT * FROM fin_imprests WHERE id = ?').get(impId); return { accountId: i.gl_account_id, ...dimFor(i.gl_account_id, 'PROJECT', i.org_project_id) }; })());
      const j = gl.postEngine(k.company_id, { voucherType: 'CV', date: k.contra_date, narration: `${CONTRA_KINDS[k.contra_kind]} ${k.doc_no}: ${k.purpose}`.slice(0, 500), sourceType: 'fin_contras', sourceId: k.id, lines: [{ ...side(k.to_bank_id, k.to_imprest_id), debit: rs(k.amount_paise) }, { ...side(k.from_bank_id, k.from_imprest_id), credit: rs(k.amount_paise) }], user: actor.user });
      db.prepare('UPDATE fin_contras SET journal_id = ? WHERE id = ?').run(j.journal.id, k.id);
      if (k.from_imprest_id) db.prepare('UPDATE fin_imprests SET balance_paise = balance_paise - ?, version = version + 1 WHERE id = ?').run(k.amount_paise, k.from_imprest_id);
      if (k.to_imprest_id) db.prepare('UPDATE fin_imprests SET balance_paise = balance_paise + ?, version = version + 1 WHERE id = ?').run(k.amount_paise, k.to_imprest_id);
      publishEvent(db, { type: 'fin.contra.posted', entity: 'fin_contras', entityId: k.id, actorId: actor.user, companyId: k.company_id, data: { contraId: k.id, docNo: k.doc_no, kind: k.contra_kind, fromBankId: k.from_bank_id, toBankId: k.to_bank_id, fromImprestId: k.from_imprest_id, toImprestId: k.to_imprest_id, amount: rs(k.amount_paise), date: k.contra_date, journalId: j.journal.id } });
    },
  });
  function contraChecks(k) {
    if (k.from_imprest_id) { const i = db.prepare('SELECT * FROM fin_imprests WHERE id = ?').get(k.from_imprest_id); if (k.amount_paise > i.balance_paise - pendingOf(i.id)) throw unprocessable(`${i.name} has ${money(i.balance_paise - pendingOf(i.id))} in hand.`); }
    if (k.to_imprest_id) { const i = db.prepare('SELECT * FROM fin_imprests WHERE id = ?').get(k.to_imprest_id); if (i.balance_paise + k.amount_paise > i.limit_paise) throw unprocessable(`${i.name} would hold ${money(i.balance_paise + k.amount_paise)}, above its limit of ${money(i.limit_paise)}.`); }
  }
  const kView = (actor, k, detail = false) => ({ id: k.id, docNo: k.doc_no, kind: k.contra_kind, kindLabel: CONTRA_KINDS[k.contra_kind], date: k.contra_date, fromBankId: k.from_bank_id, fromImprestId: k.from_imprest_id, toBankId: k.to_bank_id, toImprestId: k.to_imprest_id, amount: rs(k.amount_paise), reference: k.reference, purpose: k.purpose, status: k.status, statusLabel: STATUS[k.status], journalId: k.journal_id, can: kFlow.can(actor, k), ...(detail ? kFlow.approveInfo(actor, k) : {}) });
  const contras = {
    flow: kFlow,
    list(actor) { need(actor, 'fin.contra.view', 'see contra entries'); return db.prepare('SELECT * FROM fin_contras WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100').all(actor.companyId).map((k) => kView(actor, k)); },
    get(actor, id) { return kView(actor, kFlow.row(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.contra.create', 'enter contra entries'); const problems = []; const c = actor.companyId;
      const bank = (id, f) => { const x = id ? bankRow(c, id) : null; if (!x || x.acct_status !== 'ACTIVE') problems.push({ field: f, message: 'Choose an active bank account.' }); return x; };
      const imp = (id, f) => { const x = id ? db.prepare("SELECT * FROM fin_imprests WHERE id = ? AND company_id = ? AND imprest_status = 'ACTIVE' AND deleted_at IS NULL").get(Number(id), c) : null; if (!x) problems.push({ field: f, message: 'Choose the cash (imprest).' }); return x; };
      let from = {}; let to = {};
      if (b.kind === 'DEPOSIT') { from = { imp: imp(b.fromImprestId, 'fromImprestId') }; to = { bank: bank(b.toBankId, 'toBankId') }; }
      else if (b.kind === 'WITHDRAWAL') { from = { bank: bank(b.fromBankId, 'fromBankId') }; to = { imp: imp(b.toImprestId, 'toImprestId') }; }
      else { from = { bank: bank(b.fromBankId, 'fromBankId') }; to = { bank: bank(b.toBankId, 'toBankId') }; if (from.bank && to.bank && from.bank.id === to.bank.id) problems.push({ field: 'toBankId', message: 'Choose another bank account.' }); }
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      const row = { from_imprest_id: from.imp?.id ?? null, to_imprest_id: to.imp?.id ?? null, amount_paise: paise(b.amount) };
      try { contraChecks(row); } catch (x) { throw badRequest('Correct the highlighted fields', [{ field: 'amount', message: x.message }]); }
      return transaction(db, () => { const id = Number(db.prepare('INSERT INTO fin_contras (company_id, doc_no, contra_kind, contra_date, from_bank_id, from_imprest_id, to_bank_id, to_imprest_id, amount_paise, reference, purpose, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c, docNo(c, 'fin_contras', 'CT'), b.kind, b.date, from.bank?.id ?? null, from.imp?.id ?? null, to.bank?.id ?? null, to.imp?.id ?? null, row.amount_paise, b.reference ?? null, b.purpose, actor.user, actor.user, 'fin_contras').lastInsertRowid); audit(actor, 'fin_contras', id, 'create', c, { newValues: { kind: b.kind, amount: b.amount } }); return contras.get(actor, id); });
    },
    submit(actor, id) { kFlow.submit(actor, id); return contras.get(actor, id); },
    withdraw(actor, id, b) { kFlow.withdraw(actor, id, b); return contras.get(actor, id); },
    cancel(actor, id, b) { kFlow.cancel(actor, id, b); return contras.get(actor, id); },
    remove(actor, id) { return kFlow.remove(actor, id); },
    history(actor, id) { return kFlow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return kFlow.decide(instance, actor, outcome, comment); },
  };

  // ---- FR-05: the daily cash and bank position ----
  function position(actor, { date }) {
    need(actor, 'fin.cash_position.view', 'see the cash and bank position'); const d = date ?? todayIST(); const c = actor.companyId;
    const banks = db.prepare("SELECT * FROM fin_bank_accounts WHERE company_id = ? AND deleted_at IS NULL ORDER BY code").all(c).map((b) => {
      const p = profileOf(b.id); const start = p?.opening_date ?? '0000-01-01'; const items = bookItems(c, b.id, d).filter((i) => i.date >= start);
      const posted = db.prepare("SELECT COALESCE(SUM(credit_paise - debit_paise), 0) AS s FROM fin_bank_statements WHERE bank_account_id = ? AND match_status = 'POSTED' AND txn_date <= ? AND deleted_at IS NULL").get(b.id, d).s;
      const book = (p?.opening_paise ?? 0) + items.reduce((s, i) => s + (i.dir === 'IN' ? i.amount : -i.amount), 0) + posted;
      const today = items.filter((i) => i.date === d); const inn = today.filter((i) => i.dir === 'IN').reduce((s, i) => s + i.amount, 0); const out = today.filter((i) => i.dir === 'OUT').reduce((s, i) => s + i.amount, 0);
      const last = db.prepare('SELECT txn_date, balance_paise FROM fin_bank_statements WHERE bank_account_id = ? AND balance_paise IS NOT NULL AND txn_date <= ? AND deleted_at IS NULL ORDER BY txn_date DESC, import_id DESC, line_no DESC LIMIT 1').get(b.id, d);
      const open = db.prepare("SELECT COUNT(*) AS n FROM fin_bank_statements WHERE bank_account_id = ? AND match_status = 'UNMATCHED' AND deleted_at IS NULL").get(b.id).n;
      return { id: b.id, name: b.name, account: `••••${b.account_last4}`, kind: p?.account_kind ?? 'CURRENT', kindLabel: ACCOUNT_KINDS[p?.account_kind ?? 'CURRENT'], projectId: p?.org_project_id ?? null, book: rs(book), received: rs(inn), paid: rs(out), statement: last ? { date: last.txn_date, balance: rs(last.balance_paise) } : null, unmatched: open, odLimit: rs(p?.od_limit_paise ?? 0), available: rs(book + (p?.od_limit_paise ?? 0)) };
    });
    const cash = db.prepare("SELECT * FROM fin_imprests WHERE company_id = ? AND imprest_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY name").all(c).map((r) => impView(actor, r));
    const sum = (a, k) => Math.round(a.reduce((s, x) => s + paise(x[k] ?? 0), 0)) / 100;
    return { date: d, banks, cash, totals: { bank: sum(banks, 'book'), cash: sum(cash, 'balance'), available: sum(banks, 'available') + sum(cash, 'balance'), received: sum(banks, 'received'), paid: sum(banks, 'paid'), unmatched: banks.reduce((s, b) => s + b.unmatched, 0) } };
  }

  return { profiles, statements, brs, signBrs, imprests, vouchers, replenishments, contras, position, bookItems, autoMatch, addDays };
}
