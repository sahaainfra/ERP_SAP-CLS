import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { commOf } from '../../platform/comm/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createVault } from '../../platform/integrations/vault.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { amountInWords } from '../../../shared/i18n/words.js';
import { partnersOf } from '../mdm/partners.js';
import { nowIso, rid, same } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.04: payments. The company's own bank accounts (the account number encrypted; the ledger account; the bank file template; the cheque series). A payment proposal
// is prepared by the finance executive from the bills that may be paid (23.03 BR-02: approved, outstanding, nothing holding them), the advances approved for a vendor
// or a subcontractor, and on-account payments; each line is checked (BR-01: not more than is left to pay, counting what other open proposals and payments already
// take; a bill in one open proposal at a time; the payee's bank account active and out of its cooling-off; the name on the bank account matching the payee). It is
// approved by band (the accounts manager; above ₹10 lakh the CFO; above ₹1 crore a director), never by its preparer, and released by a third person (FR-05), who gets
// the bank file in the bank's template (validated before it is given) or the cheques with their numbers from the series. Each payment is posted at release (Dr the
// payable or the advance, Cr the bank) and `fin.payment.released` tells accounts payable; the bank's confirmation (UTR or cheque cleared) is entered or uploaded; a
// payment the bank returns, or a cheque cancelled, is reversed. The advice goes to the payee with the bills paid and their TDS.

export const PAYMENT_DOC = 'FIN_PAYMENT';
export const MODES = { NEFT: 'NEFT', RTGS: 'RTGS', IMPS: 'IMPS', CHEQUE: 'Cheque' };
export const LINE_KINDS = { BILL: 'Bill', ADVANCE: 'Advance', ON_ACCOUNT: 'On account' };
export const PAY_STATUS = { PENDING: 'Sent to the bank', PAID: 'Paid', FAILED: 'Returned by the bank', CANCELLED: 'Cancelled' };
export const RUN_STATUS = { NONE: 'Not released', RELEASED: 'Released', PART_CONFIRMED: 'Partly confirmed', CONFIRMED: 'Confirmed' };
/** The fields a bank file template may use, with how each is written. */
export const FILE_FIELDS = ['seq', 'mode', 'amount', 'valueDate', 'beneficiaryName', 'accountNo', 'ifsc', 'reference', 'debitAccount', 'email', 'purpose'];
export const FORMATS = {
  GENERIC_CSV: { label: 'Bulk upload, comma separated (with a header)', delimiter: ',', header: true, dateFormat: 'YYYY-MM-DD', columns: ['seq', 'mode', 'amount', 'valueDate', 'beneficiaryName', 'accountNo', 'ifsc', 'reference', 'email'] },
  H2H_PIPE: { label: 'Host-to-host, pipe separated (no header, a trailer with the count and total)', delimiter: '|', header: false, trailer: true, dateFormat: 'DD/MM/YYYY', columns: ['mode', 'debitAccount', 'amount', 'valueDate', 'accountNo', 'ifsc', 'beneficiaryName', 'reference', 'purpose'] },
};
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^[0-9]{9,18}$/;
const UTR = /^[A-Z0-9]{12,22}$/;
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const money = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ACTIVE_PROPOSAL = "('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')";

for (const [key, dataType, def, description] of [
  ['fin.pmt.accmgr_limit', 'integer', 1000000, 'Part 23.04 §9: a payment proposal up to this many rupees is approved by the accounts manager alone; above it the CFO approves next.'],
  ['fin.pmt.cfo_limit', 'integer', 10000000, 'Part 23.04 §9: a payment proposal above this many rupees is approved by a director after the CFO.'],
  ['fin.pmt.rtgs_min', 'integer', 200000, 'Part 23.04 FR-03: RTGS carries payments of at least this many rupees (RBI); smaller ones go by NEFT or IMPS.'],
  ['fin.pmt.imps_max', 'integer', 500000, 'Part 23.04 FR-03: IMPS carries payments of at most this many rupees (NPCI).'],
  ['fin.pmt.duplicate_days', 'integer', 30, 'Part 23.04 FR-05: a payment to the same payee of the same amount for the same reference within this many days is a duplicate.'],
  ['fin.pmt.name_match_pct', 'integer', 60, 'Part 23.04 FR-05: the share of the words of the payee\'s name (per cent) that must be in the name on the bank account.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

export const proposalList = defineList({
  code: 'fin.payment_proposals', label: 'Payment proposals', permission: 'fin.proposal.view',
  from: 'pmt_proposals x JOIN fin_bank_accounts b ON b.id = x.bank_account_id', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Proposal' }, payDate: { sql: 'x.pay_date', type: 'date', label: 'Pay on' }, bank: { sql: 'b.name', type: 'text', label: 'From bank' },
    mode: { sql: 'x.pay_mode', type: 'enum', label: 'Mode', options: Object.entries(MODES) }, lines: { sql: 'x.lines_count', type: 'number', label: 'Lines' }, total: { sql: '(x.total_paise / 100.0)', type: 'money', label: 'Total' },
    status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) }, run: { sql: 'x.run_status', type: 'enum', label: 'Run', options: Object.entries(RUN_STATUS) },
  },
});
export const paymentList = defineList({
  code: 'fin.payments', label: 'Payments', permission: 'fin.payment.view',
  from: 'pmt_payments x JOIN pmt_proposals pr ON pr.id = x.proposal_id JOIN fin_bank_accounts b ON b.id = x.bank_account_id JOIN pmt_proposal_lines l ON l.id = x.line_id', where: 'x.company_id = :c AND x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Payment' }, payee: { sql: 'x.payee_name', type: 'text', label: 'Payee' }, kind: { sql: 'l.line_kind', type: 'enum', label: 'For', options: Object.entries(LINE_KINDS) },
    mode: { sql: 'x.pay_mode', type: 'enum', label: 'Mode', options: Object.entries(MODES) }, amount: { sql: '(x.amount_paise / 100.0)', type: 'money', label: 'Amount' }, released: { sql: 'x.released_on', type: 'date', label: 'Released' },
    paidOn: { sql: 'x.paid_on', type: 'date', label: 'Paid on' }, utr: { sql: "COALESCE(x.utr, '')", type: 'text', label: 'UTR' }, cheque: { sql: "COALESCE(x.cheque_no, '')", type: 'text', label: 'Cheque' },
    bank: { sql: 'b.name', type: 'text', label: 'From bank' }, proposal: { sql: 'pr.doc_no', type: 'text', label: 'Proposal' }, status: { sql: 'x.pay_status', type: 'enum', label: 'Status', options: Object.entries(PAY_STATUS) },
  },
});

/** The words of a name for matching: lower case, no punctuation, without the words every company name has. */
const words = (s) => String(s ?? '').toLowerCase().replace(/m\/s\.?/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !['pvt', 'private', 'ltd', 'limited', 'llp', 'and', 'the', 'co', 'company', 'india', 'inc'].includes(w));
/** FR-05: does the name on the bank account match the payee? The share of the payee's words found in it. */
export function nameMatch(payee, onAccount, minPct = 60) {
  const a = words(payee); const b = new Set(words(onAccount)); if (!a.length || !b.size) return { ok: false, pct: 0 };
  const pct = Math.round((a.filter((w) => b.has(w)).length / a.length) * 100); return { ok: pct >= minPct, pct };
}
const fmtDate = (d, f) => (f === 'DD/MM/YYYY' ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
/** A value for a bank file: nothing that would break the record (the delimiter, quotes, line ends), at most 35 characters for a name. */
const clean = (v, delimiter, max = 60) => String(v ?? '').replace(/[\r\n"]/g, ' ').split(delimiter).join(' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** The template of a bank account: its format with what the account overrides; checked so that a broken template cannot make a file. */
export function templateOf(account) {
  const base = FORMATS[account.file_format] ?? FORMATS.GENERIC_CSV; let own;
  try { own = JSON.parse(account.file_template_json || '{}'); } catch { own = {}; }
  const t = { ...base, ...own };
  if (![',', '|', ';', '\t', '^'].includes(t.delimiter)) throw unprocessable(`The bank file template of ${account.name} has a delimiter the banks do not take.`);
  if (!Array.isArray(t.columns) || !t.columns.length || t.columns.some((c) => !FILE_FIELDS.includes(c))) throw unprocessable(`The bank file template of ${account.name} names a field that does not exist. Fields: ${FILE_FIELDS.join(', ')}.`);
  return t;
}
/** FR-03: the bank file of a run. */
export function buildBankFile(t, records) {
  const out = [];
  if (t.header) out.push(t.columns.join(t.delimiter));
  for (const r of records) out.push(t.columns.map((c) => (c === 'amount' ? (r.amountPaise / 100).toFixed(2) : c === 'valueDate' ? fmtDate(r.valueDate, t.dateFormat) : clean(r[c], t.delimiter, c === 'beneficiaryName' ? 35 : 60))).join(t.delimiter));
  if (t.trailer) out.push(['T', records.length, (records.reduce((a, r) => a + r.amountPaise, 0) / 100).toFixed(2)].join(t.delimiter));
  return `${out.join('\r\n')}\r\n`;
}
/** T-01: the file is read back and checked against the run before it is given: the count, the total, every record's fields, IFSC and account number. */
export function validateBankFile(t, text, expected) {
  const problems = []; const lines = text.split('\r\n').filter((l) => l !== '');
  const body = lines.slice(t.header ? 1 : 0, t.trailer ? -1 : undefined);
  if (t.header && lines[0] !== t.columns.join(t.delimiter)) problems.push('The header is not the template\'s.');
  if (body.length !== expected.count) problems.push(`${body.length} records in the file, ${expected.count} payments in the run.`);
  let total = 0;
  body.forEach((l, i) => {
    const f = l.split(t.delimiter); if (f.length !== t.columns.length) { problems.push(`Record ${i + 1} has ${f.length} fields, the template ${t.columns.length}.`); return; }
    const v = Object.fromEntries(t.columns.map((c, k) => [c, f[k]]));
    if ('amount' in v) { if (!/^[0-9]+\.[0-9]{2}$/.test(v.amount) || Number(v.amount) <= 0) problems.push(`Record ${i + 1}: the amount ${v.amount} is not an amount.`); total += paise(v.amount); }
    if ('ifsc' in v && !IFSC.test(v.ifsc)) problems.push(`Record ${i + 1}: ${v.ifsc} is not an IFSC.`);
    if ('accountNo' in v && !ACCOUNT.test(v.accountNo)) problems.push(`Record ${i + 1}: the account number is not 9 to 18 digits.`);
    if ('beneficiaryName' in v && !v.beneficiaryName) problems.push(`Record ${i + 1}: no beneficiary name.`);
    if ('mode' in v && !['NEFT', 'RTGS', 'IMPS'].includes(v.mode)) problems.push(`Record ${i + 1}: ${v.mode} is not a mode of transfer.`);
  });
  if (t.columns.includes('amount') && total !== expected.totalPaise) problems.push(`The file totals ${money(total)}, the run ${money(expected.totalPaise)}.`);
  if (t.trailer) { const tr = (lines.at(-1) ?? '').split(t.delimiter); if (tr[0] !== 'T' || Number(tr[1]) !== expected.count || paise(tr[2]) !== expected.totalPaise) problems.push('The trailer does not carry the count and the total of the run.'); }
  return problems;
}

/** @param {{ db: any, base: any, gl: any, ap: any, vaultKey?: string }} o */
export function createPaymentService({ db, base, gl, ap, vaultKey }) {
  const { may, audit, notify } = base;
  const vault = createVault({ secret: vaultKey ?? undefined });
  const slot = (companyId, code) => `fin_bank_account/${companyId}/${code}`;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const partnerOf = (companyId, id) => (id ? db.prepare('SELECT * FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), companyId) : null);
  const isSub = (pid) => Boolean(db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role = 'SUBCONTRACTOR' AND deleted_at IS NULL").get(pid));
  const apAccount = (companyId, pid) => acct(companyId, isSub(pid) ? '220002' : '220001');
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };
  const limits = (companyId) => ({ acc: Number(param(companyId, 'fin.pmt.accmgr_limit') ?? 1000000) * 100, cfo: Number(param(companyId, 'fin.pmt.cfo_limit') ?? 10000000) * 100 });

  // ---- the company's bank accounts ----
  const bankRow = (companyId, id) => db.prepare('SELECT * FROM fin_bank_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), companyId);
  /** The book balance of a bank account (the ledger, 23.01); the cash position of 23.13 is not built yet (D-716). */
  const bookBalance = (companyId, glId) => db.prepare('SELECT COALESCE(SUM(debit_paise - credit_paise), 0) AS b FROM fin_balances WHERE company_id = ? AND account_id = ?').get(companyId, glId).b;
  const bankView = (b) => ({ id: b.id, code: b.code, name: b.name, bankName: b.bank_name, ifsc: b.ifsc, account: `••••••${b.account_last4}`, glAccountId: b.gl_account_id, glAccount: db.prepare('SELECT code, name FROM fin_accounts WHERE id = ?').get(b.gl_account_id), fileFormat: b.file_format, fileFormatLabel: FORMATS[b.file_format]?.label ?? b.file_format, template: (() => { try { return templateOf(b); } catch (x) { return { error: x.message }; } })(), chequeNext: b.cheque_next_no, chequeLast: b.cheque_last_no, chequesLeft: b.cheque_next_no != null && b.cheque_last_no != null ? Math.max(0, b.cheque_last_no - b.cheque_next_no + 1) : 0, status: b.acct_status, balance: rs(bookBalance(b.company_id, b.gl_account_id)), version: b.version });
  const banks = {
    formats: () => Object.entries(FORMATS).map(([code, f]) => ({ code, label: f.label, columns: f.columns, delimiter: f.delimiter })),
    list(actor) { need(actor, 'fin.bank.view', 'see the company\'s bank accounts'); return db.prepare('SELECT * FROM fin_bank_accounts WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map(bankView); },
    get(actor, id) { need(actor, 'fin.bank.view', 'see the company\'s bank accounts'); const b = bankRow(actor.companyId, id); if (!b) throw notFound('That bank account does not exist.'); return bankView(b); },
    save(actor, id, v) {
      need(actor, 'fin.bank.manage', 'set up the company\'s bank accounts'); const c = actor.companyId; const old = id ? bankRow(c, id) : null; if (id && !old) throw notFound('That bank account does not exist.');
      if (old && v.version !== old.version) throw conflict('The bank account was changed by someone else; reload it.');
      const problems = [];
      const glA = db.prepare("SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND account_type = 'BANK' AND account_status = 'ACTIVE' AND deleted_at IS NULL").get(Number(v.glAccountId), c);
      if (!glA) problems.push({ field: 'glAccountId', message: 'Choose a ledger account of the type Bank.' });
      if (!IFSC.test(v.ifsc)) problems.push({ field: 'ifsc', message: 'An IFSC is 11 characters: four letters, 0, six letters or digits.' });
      if (!old && !v.accountNo) problems.push({ field: 'accountNo', message: 'Enter the account number.' });
      if (v.accountNo && !ACCOUNT.test(v.accountNo)) problems.push({ field: 'accountNo', message: 'An account number is 9 to 18 digits.' });
      if (!FORMATS[v.fileFormat]) problems.push({ field: 'fileFormat', message: 'Choose a bank file format.' });
      if ((v.chequeFrom == null) !== (v.chequeTo == null) || (v.chequeFrom != null && v.chequeTo < v.chequeFrom)) problems.push({ field: 'chequeTo', message: 'Give the first and the last cheque number of the book, the last not before the first.' });
      if (db.prepare('SELECT 1 FROM fin_bank_accounts WHERE company_id = ? AND code = ? AND id != ? AND deleted_at IS NULL').get(c, v.code, id ?? 0)) problems.push({ field: 'code', message: 'Another bank account has this code.' });
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      try { templateOf({ name: v.name, file_format: v.fileFormat, file_template_json: JSON.stringify(v.template ?? {}) }); } catch (x) { throw badRequest('Correct the highlighted fields', [{ field: 'template', message: x.message }]); }
      return transaction(db, () => {
        if (!old) {
          const nid = Number(db.prepare('INSERT INTO fin_bank_accounts (company_id, code, name, bank_name, ifsc, account_no_enc, account_last4, gl_account_id, file_format, file_template_json, cheque_next_no, cheque_last_no, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(c, v.code, v.name, v.bankName, v.ifsc, vault.encrypt(v.accountNo, slot(c, v.code)), v.accountNo.slice(-4), glA.id, v.fileFormat, JSON.stringify(v.template ?? {}), v.chequeFrom ?? null, v.chequeTo ?? null, actor.user, 'fin_bank_accounts').lastInsertRowid);
          audit(actor, 'fin_bank_accounts', nid, 'create', c, { newValues: { code: v.code, name: v.name, ifsc: v.ifsc, account: `••••${v.accountNo.slice(-4)}`, gl: glA.code, format: v.fileFormat } });
          return banks.get(actor, nid);
        }
        if (v.code !== old.code && !v.accountNo) throw badRequest('Correct the highlighted fields', [{ field: 'accountNo', message: 'Enter the account number again when the code changes.' }]);
        const enc = v.accountNo ? vault.encrypt(v.accountNo, slot(c, v.code)) : old.account_no_enc;
        db.prepare('UPDATE fin_bank_accounts SET code = ?, name = ?, bank_name = ?, ifsc = ?, account_no_enc = ?, account_last4 = ?, gl_account_id = ?, file_format = ?, file_template_json = ?, cheque_next_no = ?, cheque_last_no = ?, acct_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(v.code, v.name, v.bankName, v.ifsc, enc, v.accountNo ? v.accountNo.slice(-4) : old.account_last4, glA.id, v.fileFormat, JSON.stringify(v.template ?? {}), v.chequeFrom ?? null, v.chequeTo ?? null, v.blocked ? 'BLOCKED' : 'ACTIVE', actor.user, nowIso(), old.id);
        audit(actor, 'fin_bank_accounts', old.id, 'update', c, { oldValues: { ifsc: old.ifsc, account: `••••${old.account_last4}`, format: old.file_format, cheques: `${old.cheque_next_no ?? ''}-${old.cheque_last_no ?? ''}`, status: old.acct_status }, newValues: { ifsc: v.ifsc, account: `••••${v.accountNo ? v.accountNo.slice(-4) : old.account_last4}`, format: v.fileFormat, cheques: `${v.chequeFrom ?? ''}-${v.chequeTo ?? ''}`, status: v.blocked ? 'BLOCKED' : 'ACTIVE' } });
        return banks.get(actor, old.id);
      });
    },
  };

  // ---- BR-01: what is left to pay ----
  /** What payments already take of a bill (sent or paid) and what open proposals not yet released reserve, other than one proposal. */
  const takenOfBill = (billId, exceptProposal = 0) => db.prepare(`SELECT
      (SELECT COALESCE(SUM(p.amount_paise), 0) FROM pmt_payments p JOIN pmt_proposal_lines l ON l.id = p.line_id WHERE l.ap_bill_id = :b AND p.pay_status IN ('PENDING', 'PAID')) AS paid,
      (SELECT COALESCE(SUM(l.amount_paise), 0) FROM pmt_proposal_lines l JOIN pmt_proposals pr ON pr.id = l.proposal_id WHERE l.ap_bill_id = :b AND l.line_status = 'PROPOSED' AND pr.status IN ${ACTIVE_PROPOSAL} AND pr.run_status = 'NONE' AND pr.deleted_at IS NULL AND pr.id != :x) AS reserved,
      (SELECT pr.doc_no FROM pmt_proposal_lines l JOIN pmt_proposals pr ON pr.id = l.proposal_id WHERE l.ap_bill_id = :b AND l.line_status = 'PROPOSED' AND pr.status IN ${ACTIVE_PROPOSAL} AND pr.run_status = 'NONE' AND pr.deleted_at IS NULL AND pr.id != :x LIMIT 1) AS inProposal`).get({ b: billId, x: exceptProposal });
  const takenOfAdvance = (advId, exceptProposal = 0) => db.prepare(`SELECT
      (SELECT COALESCE(SUM(p.amount_paise), 0) FROM pmt_payments p JOIN pmt_proposal_lines l ON l.id = p.line_id WHERE l.advance_id = :a AND p.pay_status IN ('PENDING', 'PAID')) AS paid,
      (SELECT COALESCE(SUM(l.amount_paise), 0) FROM pmt_proposal_lines l JOIN pmt_proposals pr ON pr.id = l.proposal_id WHERE l.advance_id = :a AND l.line_status = 'PROPOSED' AND pr.status IN ${ACTIVE_PROPOSAL} AND pr.run_status = 'NONE' AND pr.deleted_at IS NULL AND pr.id != :x) AS reserved,
      (SELECT pr.doc_no FROM pmt_proposal_lines l JOIN pmt_proposals pr ON pr.id = l.proposal_id WHERE l.advance_id = :a AND l.line_status = 'PROPOSED' AND pr.status IN ${ACTIVE_PROPOSAL} AND pr.run_status = 'NONE' AND pr.deleted_at IS NULL AND pr.id != :x LIMIT 1) AS inProposal`).get({ a: advId, x: exceptProposal });
  const billLeft = (b, exceptProposal = 0) => { const t = takenOfBill(b.id, exceptProposal); return { left: b.net_payable_paise - b.adjusted_paise - t.paid - t.reserved, inProposal: t.inProposal }; };
  const advanceLeft = (a, exceptProposal = 0) => { const t = takenOfAdvance(a.id, exceptProposal); return { left: a.amount_paise - t.paid - t.reserved, inProposal: t.inProposal }; };
  /** The payee's bank account a transfer goes to: the primary active one, out of its cooling-off (FR-05). */
  const payeeBank = (partnerId, today = todayIST()) => {
    const cooling = db.prepare("SELECT cooling_off_until FROM mdm_partner_banks WHERE partner_id = ? AND deleted_at IS NULL AND cooling_off_until >= ? ORDER BY id DESC LIMIT 1").get(partnerId, today);
    if (cooling) return { problem: `The bank account was changed: payments wait until ${cooling.cooling_off_until}.`, code: 'BANK_COOLING_OFF' };
    const bk = db.prepare("SELECT * FROM mdm_partner_banks WHERE partner_id = ? AND bank_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY is_primary DESC, id DESC LIMIT 1").get(partnerId);
    if (!bk) return { problem: 'The payee has no active bank account.', code: 'NO_BANK' };
    return { bank: bk };
  };
  const partnerHold = (p, today = todayIST()) => (p.payment_hold_until && p.payment_hold_until >= today ? (p.payment_hold_reason ?? `On hold until ${p.payment_hold_until}`) : null);

  /** Every check of one line (BR-01, FR-05); returns the values to keep, or the problems. */
  function checkLine(companyId, l, mode, proposalId, i) {
    const f = (field, message) => ({ field: `lines.${i}.${field}`, message }); const problems = []; const amt = paise(l.amount); let v = { kind: l.kind, amount: amt, purpose: l.purpose ?? null };
    if (!(amt > 0)) problems.push(f('amount', 'The amount is more than nothing.'));
    if (l.kind === 'BILL') {
      const b = db.prepare('SELECT * FROM ap_bills WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(l.billId), companyId);
      if (!b || b.status !== 'APPROVED') return { problems: [f('billId', 'Choose an approved AP bill.')] };
      if (!b.partner_id) return { problems: [f('billId', `${b.doc_no} is payable to an employee: claims are paid when their payable is posted (D-712).`)] };
      const holds = ap.holdsOf(b); if (holds.length) problems.push(f('billId', `${b.doc_no} is on hold: ${holds.map((h) => h.reason).join('; ')}.`));
      const { left, inProposal } = billLeft(b, proposalId);
      if (inProposal) problems.push(f('billId', `${b.doc_no} is already in proposal ${inProposal} (a bill is in one open proposal at a time).`));
      else if (amt > left) problems.push(f('amount', `${b.doc_no} has ${money(Math.max(0, left))} left to pay.`));
      v = { ...v, billId: b.id, partnerId: b.partner_id, tds: b.tds_paise, projectId: b.org_project_id, ref: b.bill_no ?? b.doc_no, billDoc: b.doc_no };
    } else if (l.kind === 'ADVANCE') {
      const a = db.prepare("SELECT * FROM bill_advances WHERE id = ? AND company_id = ? AND direction = 'GIVEN' AND status = 'APPROVED' AND deleted_at IS NULL").get(Number(l.advanceId), companyId);
      if (!a) return { problems: [f('advanceId', 'Choose an advance approved for a vendor or a subcontractor.')] };
      const { left, inProposal } = advanceLeft(a, proposalId);
      if (inProposal) problems.push(f('advanceId', `${a.doc_no} is already in proposal ${inProposal}.`));
      else if (amt > left) problems.push(f('amount', `${a.doc_no} has ${money(Math.max(0, left))} left to pay.`));
      v = { ...v, advanceId: a.id, partnerId: a.party_id, tds: 0, projectId: a.org_project_id ?? null, ref: a.ref_no ?? a.doc_no };
    } else {
      if (!db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role IN ('VENDOR', 'SUBCONTRACTOR') AND deleted_at IS NULL").get(Number(l.partnerId))) return { problems: [f('partnerId', 'Choose a vendor or a subcontractor.')] };
      if (!l.purpose) problems.push(f('purpose', 'Say what the on-account payment is for.'));
      if (l.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(l.projectId), companyId)) problems.push(f('projectId', 'The project does not exist.'));
      v = { ...v, partnerId: Number(l.partnerId), tds: 0, projectId: l.projectId ? Number(l.projectId) : null, ref: l.purpose ?? 'On account' };
    }
    const p = partnerOf(companyId, v.partnerId); if (!p) return { problems: [f('partnerId', 'The payee does not exist.')] };
    // the debit line must satisfy its account's dimension rules (06.05) now, not only when the payment is posted at release
    const chk = gl.checkLines(companyId, [{ accountId: l.kind === 'ADVANCE' ? acct(companyId, '160001') : apAccount(companyId, p.id), debit: '1', partnerId: p.id, ...(v.projectId ? { projectId: v.projectId } : {}) }, { accountId: acct(companyId, '150002') ?? acct(companyId, '220001'), credit: '1' }], { source: 'ENGINE' });
    for (const x of chk.problems.filter((q) => q.field.startsWith('lines.0.'))) problems.push(f(x.field.endsWith('projectId') ? 'projectId' : 'partnerId', x.message));
    if (p.partner_status && !['ACTIVE'].includes(p.partner_status)) problems.push(f('partnerId', `${p.legal_name} is not active (${p.partner_status}).`));
    const hold = partnerHold(p); if (hold && l.kind !== 'BILL') problems.push(f('partnerId', `${p.legal_name} is on hold: ${hold}.`));
    v.payee = p.legal_name;
    // the duplicate check (FR-05): the same payee, amount and reference paid within the days
    const days = Number(param(companyId, 'fin.pmt.duplicate_days') ?? 30);
    const dup = db.prepare(`SELECT p.doc_no FROM pmt_payments p JOIN pmt_proposal_lines l ON l.id = p.line_id WHERE p.company_id = ? AND p.partner_id = ? AND p.amount_paise = ? AND p.pay_status IN ('PENDING', 'PAID') AND p.released_on >= date('now', ?) AND l.line_kind = ? AND COALESCE(l.ap_bill_id, 0) = ? AND COALESCE(l.advance_id, 0) = ? AND COALESCE(l.purpose, '') = ? LIMIT 1`).get(companyId, v.partnerId, amt, `-${days} days`, l.kind, v.billId ?? 0, v.advanceId ?? 0, l.kind === 'ON_ACCOUNT' ? (l.purpose ?? '') : (l.purpose ?? ''));
    if (dup) problems.push(f('amount', `A payment of the same amount for the same reference was made to ${p.legal_name} in the last ${days} days (${dup.doc_no}): a duplicate.`));
    if (mode !== 'CHEQUE') {
      const pb = payeeBank(p.id);
      if (pb.problem) problems.push(f('partnerId', `${p.legal_name}: ${pb.problem}`));
      else {
        const m = nameMatch(p.legal_name, pb.bank.account_name, Number(param(companyId, 'fin.pmt.name_match_pct') ?? 60));
        v = { ...v, bankId: pb.bank.id, last4: pb.bank.account_last4, ifsc: pb.bank.ifsc, accountName: pb.bank.account_name, nameMatch: m.ok ? 'OK' : 'MISMATCH' };
        if (!m.ok) problems.push(f('partnerId', `The name on ${p.legal_name}'s bank account ("${pb.bank.account_name}") does not match the payee (${m.pct} % of the words).`));
      }
      if (mode === 'RTGS' && amt < Number(param(companyId, 'fin.pmt.rtgs_min') ?? 200000) * 100) problems.push(f('amount', `RTGS carries ${money(Number(param(companyId, 'fin.pmt.rtgs_min') ?? 200000) * 100)} or more; pay this by NEFT.`));
      if (mode === 'IMPS' && amt > Number(param(companyId, 'fin.pmt.imps_max') ?? 500000) * 100) problems.push(f('amount', `IMPS carries at most ${money(Number(param(companyId, 'fin.pmt.imps_max') ?? 500000) * 100)}; pay this by NEFT or RTGS.`));
    } else v = { ...v, nameMatch: 'UNCHECKED' };
    return { problems, v };
  }

  // ---- FR-02: the proposal and its approval by band ----
  const flow = createFlow({
    db, base, docType: PAYMENT_DOC, table: 'pmt_proposals', perm: 'fin.proposal', label: 'payment proposal', route: '/finance/payment-proposals?id=',
    where: () => ({ pid: null, sid: null }),
    ctx: (r) => { const L = limits(r.company_id); return { total: rs(r.total_paise), overAcc: r.total_paise > L.acc ? 1 : 0, overCfo: r.total_paise > L.cfo ? 1 : 0 }; },
    title: (r) => `${r.lines_count} payment(s) ${money(r.total_paise)} by ${r.pay_mode} on ${r.pay_date}`, notifyCode: 'fin.payment.decided', numberKey: 'FIN_PAYMENT', prefix: 'PP',
    beforeSubmit: (actor, r) => {
      const lines = db.prepare("SELECT * FROM pmt_proposal_lines WHERE proposal_id = ? AND line_status = 'PROPOSED' AND deleted_at IS NULL ORDER BY line_no").all(r.id);
      if (!lines.length) throw unprocessable('A proposal with no lines is not sent for approval.');
      const problems = lines.flatMap((l, i) => checkLine(r.company_id, { kind: l.line_kind, billId: l.ap_bill_id, advanceId: l.advance_id, partnerId: l.partner_id, projectId: l.project_id, amount: l.amount_paise / 100, purpose: l.purpose }, r.pay_mode, r.id, i).problems);
      if (problems.length) throw badRequest('The proposal cannot be sent: correct the highlighted lines', problems);
      void actor;
    },
    onApproved: (_actor, r) => { notify(r.company_id, 'fin.payment.decided', ['permission:fin.payment.release'], r.doc_no, 'ready to release', `${r.doc_no}: ${r.lines_count} payment(s) of ${money(r.total_paise)} approved; release it (a person who neither prepared nor approved it).`, `/finance/payment-proposals?id=${r.id}`, r.id); },
  });

  const proposalRow = (actor, id) => flow.row(actor, id);
  function linesOf(proposalId) { return db.prepare('SELECT l.*, b.doc_no AS bill_doc, b.bill_no, b.bill_date, b.due_date, b.msme_due_date, a.doc_no AS adv_doc FROM pmt_proposal_lines l LEFT JOIN ap_bills b ON b.id = l.ap_bill_id LEFT JOIN bill_advances a ON a.id = l.advance_id WHERE l.proposal_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(proposalId); }
  const approversOf = (r) => (r.workflow_instance_id ? db.prepare("SELECT DISTINCT actor FROM wf_history WHERE instance_id = ? AND event = 'APPROVED'").all(r.workflow_instance_id).map((x) => x.actor) : []);
  /** FR-05: who may release: the right, and neither the preparer nor an approver. */
  const sodOf = (actor, r) => { if (same(r.requested_by, actor.user) || same(r.created_by, actor.user)) return 'You prepared this proposal: another person releases it.'; if (approversOf(r).some((a) => same(a, actor.user))) return 'You approved this proposal: another person releases it.'; return null; };
  function proposalView(actor, r, detail = false) {
    const b = bankRow(r.company_id, r.bank_account_id); const c0 = flow.can(actor, r); const sod = r.status === 'APPROVED' ? sodOf(actor, r) : null;
    const L = limits(r.company_id); const band = r.total_paise > L.cfo ? 'DIR' : r.total_paise > L.acc ? 'CFO' : 'ACCMGR';
    const o = { id: r.id, docNo: r.doc_no, bankAccountId: r.bank_account_id, bank: b ? { id: b.id, name: b.name, account: `••••••${b.account_last4}`, ifsc: b.ifsc, balance: rs(bookBalance(r.company_id, b.gl_account_id)), fileFormat: b.file_format, chequesLeft: b.cheque_next_no != null ? Math.max(0, b.cheque_last_no - b.cheque_next_no + 1) : 0 } : null,
      payMode: r.pay_mode, payDate: r.pay_date, purpose: r.purpose, total: rs(r.total_paise), linesCount: r.lines_count, band, bandLabel: { ACCMGR: 'Accounts manager', CFO: 'Accounts manager, then the CFO', DIR: 'Accounts manager, the CFO, then a director' }[band],
      status: r.status, statusLabel: STATUS[r.status], runStatus: r.run_status, runLabel: RUN_STATUS[r.run_status], releasedBy: r.released_by, releasedAt: r.released_at, fileName: r.file_name, requestedBy: r.requested_by, createdBy: r.created_by, version: r.version, cancelReason: r.cancel_reason,
      can: { ...c0, release: r.status === 'APPROVED' && r.run_status === 'NONE' && may(actor, 'fin.payment.release') && !sod, releaseBlocked: r.status === 'APPROVED' && r.run_status === 'NONE' && may(actor, 'fin.payment.release') ? sod : null, file: r.run_status !== 'NONE' && r.pay_mode !== 'CHEQUE' && may(actor, 'fin.payment.release'), cheques: r.run_status !== 'NONE' && r.pay_mode === 'CHEQUE' && may(actor, 'fin.payment.print'), confirm: ['RELEASED', 'PART_CONFIRMED'].includes(r.run_status) && may(actor, 'fin.payment.confirm') } };
    if (detail) {
      o.lines = linesOf(r.id).map((l) => ({ id: l.id, lineNo: l.line_no, kind: l.line_kind, kindLabel: LINE_KINDS[l.line_kind], billId: l.ap_bill_id, billDoc: l.bill_doc, billNo: l.bill_no, billDate: l.bill_date, dueDate: l.due_date, msmeDue: l.msme_due_date, advanceId: l.advance_id, advanceDoc: l.adv_doc, partnerId: l.partner_id, payee: l.payee_name, bank: l.bank_last4 ? `••••${l.bank_last4} ${l.bank_ifsc}` : null, accountName: l.bank_account_name, nameMatch: l.name_match, amount: rs(l.amount_paise), tds: rs(l.tds_paise), purpose: l.purpose, status: l.line_status, removedReason: l.line_status === 'REMOVED' ? l.remarks : null }));
      o.payments = db.prepare('SELECT * FROM pmt_payments WHERE proposal_id = ? ORDER BY id').all(r.id).map((p) => paymentView(actor, p));
      o.evidence = o.lines.filter((l) => l.status !== 'REMOVED').map((l) => { const bill = l.billId ? db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(l.billId) : null; return { lineNo: l.lineNo, payee: l.payee, source: bill ? `${bill.doc_no} from ${bill.bill_source} ${bill.source_ref ?? ''}`.trim() : l.advanceDoc ? `Advance ${l.advanceDoc}` : 'On account', holds: bill ? ap.holdsOf(bill).map((h) => h.reason) : [], nameMatch: l.nameMatch, bank: l.bank }; });
      Object.assign(o, flow.approveInfo(actor, r));
    }
    return o;
  }

  function writeLines(actor, r, list) {
    const problems = []; const vals = [];
    list.forEach((l, i) => { const c = checkLine(actor.companyId, l, r.pay_mode, r.id, i); problems.push(...c.problems); vals.push(c.v); });
    // within the proposal, a bill or an advance is once
    const seen = new Set(); list.forEach((l, i) => { const k = l.kind === 'BILL' ? `b${l.billId}` : l.kind === 'ADVANCE' ? `a${l.advanceId}` : null; if (k && seen.has(k)) problems.push({ field: `lines.${i}.${l.kind === 'BILL' ? 'billId' : 'advanceId'}`, message: 'This is already a line of the proposal.' }); if (k) seen.add(k); });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    db.prepare("UPDATE pmt_proposal_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE proposal_id = ? AND deleted_at IS NULL").run(nowIso(), actor.user, r.id);
    const ins = db.prepare('INSERT INTO pmt_proposal_lines (company_id, proposal_id, line_no, line_kind, ap_bill_id, advance_id, partner_id, payee_name, partner_bank_id, bank_last4, bank_ifsc, bank_account_name, name_match, amount_paise, tds_paise, purpose, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const maxNo = db.prepare('SELECT COALESCE(MAX(line_no), 0) AS n FROM pmt_proposal_lines WHERE proposal_id = ?').get(r.id).n;
    vals.forEach((v, i) => ins.run(actor.companyId, r.id, maxNo + i + 1, v.kind, v.billId ?? null, v.advanceId ?? null, v.partnerId, v.payee, v.bankId ?? null, v.last4 ?? null, v.ifsc ?? null, v.accountName ?? null, v.nameMatch ?? 'UNCHECKED', v.amount, v.tds ?? 0, v.purpose ?? null, v.projectId ?? null, actor.user, v.billId ? 'ap_bills' : v.advanceId ? 'bill_advances' : 'mdm_partners', String(v.billId ?? v.advanceId ?? v.partnerId)));
    const total = vals.reduce((a, v) => a + v.amount, 0);
    db.prepare('UPDATE pmt_proposals SET total_paise = ?, lines_count = ? WHERE id = ?').run(total, vals.length, r.id);
    return total;
  }
  function header(actor, b) {
    const bank = bankRow(actor.companyId, b.bankAccountId); const problems = [];
    if (!bank || bank.acct_status !== 'ACTIVE') problems.push({ field: 'bankAccountId', message: 'Choose an active bank account of the company.' });
    if (!MODES[b.payMode]) problems.push({ field: 'payMode', message: 'Choose how to pay.' });
    if (bank && b.payMode === 'CHEQUE' && bank.cheque_next_no == null) problems.push({ field: 'payMode', message: `${bank.name} has no cheque book set up.` });
    if (b.payDate < todayIST()) problems.push({ field: 'payDate', message: 'The date to pay is today or later.' });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    return bank;
  }
  const proposals = {
    flow,
    list(actor, query) { need(actor, 'fin.proposal.view', 'see payment proposals'); return runList(db, proposalList, parseListRequest(proposalList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => proposalView(actor, r) }); },
    get(actor, id) { need(actor, 'fin.proposal.view', 'see payment proposals'); return proposalView(actor, proposalRow(actor, id), true); },
    /** FR-01: what may be paid: the bills (BR-02 of 23.03, less what open proposals and payments take), the advances approved, with the MSME and overdue first. */
    candidates(actor, { dueBy, projectId, partnerId, msmeOnly, exceptProposal = 0 }) {
      need(actor, 'fin.proposal.create', 'prepare payment proposals'); need(actor, 'fin.bill.view', 'see payable bills'); const today = todayIST();
      // the bills that may be paid, most urgent first (the MSME date, then the due date), at most 200 at a time; narrowed by the filters in SQL
      const rows = db.prepare(`SELECT * FROM ap_bills WHERE company_id = :c AND status = 'APPROVED' AND deleted_at IS NULL AND partner_id IS NOT NULL AND net_payable_paise - adjusted_paise - paid_paise > 0 AND due_date <= :due
          AND (:proj = 0 OR org_project_id = :proj) AND (:par = 0 OR partner_id = :par) AND (:msme = 0 OR msme = 1) ORDER BY COALESCE(msme_due_date, due_date), due_date, id LIMIT 400`)
        .all({ c: actor.companyId, due: dueBy ?? '9999-12-31', proj: Number(projectId ?? 0), par: Number(partnerId ?? 0), msme: msmeOnly ? 1 : 0 }).filter((b) => ap.holdsOf(b).length === 0).slice(0, 200);
      const bills = rows.map((row) => {
        const { left, inProposal } = billLeft(row, Number(exceptProposal));
        const b = { id: row.id, docNo: row.doc_no, billNo: row.bill_no, partnerId: row.partner_id, payee: row.payee_name, projectId: row.org_project_id, billDate: row.bill_date, dueDate: row.due_date, msmeDue: row.msme_due_date, msme: Boolean(row.msme), outstanding: rs(row.net_payable_paise - row.adjusted_paise - row.paid_paise), tds: rs(row.tds_paise) };
        const p = partnerOf(actor.companyId, b.partnerId); const hold = partnerHold(p);
        const pb = payeeBank(b.partnerId); const nm = pb.bank ? nameMatch(p.legal_name, pb.bank.account_name, Number(param(actor.companyId, 'fin.pmt.name_match_pct') ?? 60)) : null;
        return { kind: 'BILL', billId: b.id, docNo: b.docNo, billNo: b.billNo, partnerId: b.partnerId, payee: b.payee, projectId: b.projectId, billDate: b.billDate, dueDate: b.dueDate, msmeDue: b.msmeDue, msme: b.msme, overdue: (b.msmeDue ?? b.dueDate) < today, outstanding: b.outstanding, left: rs(left), tds: b.tds, inProposal, blocked: inProposal ? `In ${inProposal}` : hold ? `Payee on hold: ${hold}` : null, bank: pb.bank ? `••••${pb.bank.account_last4}` : null, bankProblem: pb.problem ?? (nm && !nm.ok ? 'The name on the bank account does not match' : null) };
      }).filter((b) => b.left > 0);
      const advances = db.prepare("SELECT a.*, p.legal_name FROM bill_advances a JOIN mdm_partners p ON p.id = a.party_id WHERE a.company_id = ? AND a.direction = 'GIVEN' AND a.status = 'APPROVED' AND a.deleted_at IS NULL ORDER BY a.advance_date").all(actor.companyId)
        .filter((a) => (!projectId || a.org_project_id === Number(projectId)) && (!partnerId || a.party_id === Number(partnerId))).map((a) => { const { left, inProposal } = advanceLeft(a, Number(exceptProposal)); const pb = payeeBank(a.party_id); return { kind: 'ADVANCE', advanceId: a.id, docNo: a.doc_no, partnerId: a.party_id, payee: a.legal_name, type: a.adv_type, date: a.advance_date, amount: rs(a.amount_paise), left: rs(left), inProposal, blocked: inProposal ? `In ${inProposal}` : null, bank: pb.bank ? `••••${pb.bank.account_last4}` : null, bankProblem: pb.problem ?? null }; }).filter((a) => a.left > 0);
      const prio = (b) => (b.msme && b.overdue ? 0 : b.msme ? 1 : b.overdue ? 2 : 3);
      bills.sort((x, y) => prio(x) - prio(y) || String(x.msmeDue ?? x.dueDate).localeCompare(String(y.msmeDue ?? y.dueDate)));
      return { bills, advances, banks: banks.list({ ...actor }).filter((b) => b.status === 'ACTIVE').map((b) => ({ id: b.id, name: b.name, account: b.account, balance: b.balance, chequesLeft: b.chequesLeft, fileFormat: b.fileFormat })), limits: { accmgr: limits(actor.companyId).acc / 100, cfo: limits(actor.companyId).cfo / 100, rtgsMin: Number(param(actor.companyId, 'fin.pmt.rtgs_min') ?? 200000), impsMax: Number(param(actor.companyId, 'fin.pmt.imps_max') ?? 500000) } };
    },
    create(actor, b) {
      need(actor, 'fin.proposal.create', 'prepare payment proposals'); header(actor, b);
      if (b.total != null && paise(b.total) !== b.lines.reduce((a, l) => a + paise(l.amount), 0)) throw badRequest('Correct the highlighted fields', [{ field: 'total', message: 'The total sent does not match the lines.' }]);
      return transaction(db, () => {
        const id = Number(db.prepare('INSERT INTO pmt_proposals (company_id, doc_no, bank_account_id, pay_mode, pay_date, purpose, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, docNo(actor.companyId, 'pmt_proposals', 'PP'), Number(b.bankAccountId), b.payMode, b.payDate, b.purpose ?? null, actor.user, actor.user, 'pmt_proposals').lastInsertRowid);
        const r = db.prepare('SELECT * FROM pmt_proposals WHERE id = ?').get(id); const total = writeLines(actor, r, b.lines);
        audit(actor, 'pmt_proposals', id, 'create', actor.companyId, { newValues: { mode: b.payMode, lines: b.lines.length, total: rs(total) } });
        return proposals.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'fin.proposal.edit'); need(actor, 'fin.proposal.edit', 'change payment proposals'); if (!flow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned proposal is changed.'); if (b.version !== r.version) throw conflict('The proposal was changed by someone else; reload it.');
      header(actor, b);
      return transaction(db, () => {
        db.prepare('UPDATE pmt_proposals SET bank_account_id = ?, pay_mode = ?, pay_date = ?, purpose = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(Number(b.bankAccountId), b.payMode, b.payDate, b.purpose ?? null, actor.user, nowIso(), r.id);
        const total = writeLines(actor, { ...r, pay_mode: b.payMode }, b.lines);
        audit(actor, 'pmt_proposals', r.id, 'update', actor.companyId, { oldValues: { total: rs(r.total_paise), lines: r.lines_count }, newValues: { total: rs(total), lines: b.lines.length } });
        return proposals.get(actor, r.id);
      });
    },
    remove(actor, id) { return flow.remove(actor, id); },
    submit(actor, id) { flow.submit(actor, id); return proposals.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return proposals.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return proposals.get(actor, id); },
    history(actor, id) { return flow.history(actor, id); },
    decide(instance, actor, outcome, comment) { return flow.decide(instance, actor, outcome, comment); },
    /** An approved proposal not yet released: a line that can no longer be paid is taken out (the total only falls; no new approval). */
    dropLine(actor, id, lineId, { reason }) {
      need(actor, 'fin.payment.release', 'take lines out of an approved proposal'); const r = proposalRow(actor, id);
      if (r.status !== 'APPROVED' || r.run_status !== 'NONE') throw conflict('Lines are taken out of an approved proposal before it is released; otherwise return or cancel it.');
      const l = db.prepare("SELECT * FROM pmt_proposal_lines WHERE id = ? AND proposal_id = ? AND line_status = 'PROPOSED' AND deleted_at IS NULL").get(Number(lineId), r.id); if (!l) throw notFound('That line is not in the proposal.');
      return transaction(db, () => {
        db.prepare("UPDATE pmt_proposal_lines SET line_status = 'REMOVED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), l.id);
        db.prepare("UPDATE pmt_proposals SET total_paise = total_paise - ?, lines_count = lines_count - 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(l.amount_paise, actor.user, nowIso(), r.id);
        audit(actor, 'pmt_proposals', r.id, 'drop_line', r.company_id, { reason, oldValues: { line: l.line_no, payee: l.payee_name, amount: rs(l.amount_paise) } });
        return proposals.get(actor, r.id);
      });
    },
    exportCsv(actor, query = {}) { need(actor, 'fin.proposal.export', 'export payment proposals'); const l = proposals.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'pmt_proposals', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `payment-proposals-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Proposal', 'Pay on', 'From bank', 'Mode', 'Lines', 'Total', 'Approval', 'Run'], l.data.map((x) => [x.docNo, x.payDate, x.bank?.name ?? '', x.payMode, x.linesCount, x.total, x.statusLabel, x.runLabel]))}`, 'utf8') }; },
    print(actor, id) { need(actor, 'fin.proposal.print', 'print payment proposals'); const v = proposals.get(actor, id); audit(actor, 'pmt_proposals', v.id, 'print', actor.companyId); return { buffer: toPdf({ columns: [{ key: 'n', label: '#', type: 'number' }, { key: 'payee', label: 'Payee', type: 'text' }, { key: 'kind', label: 'For', type: 'text' }, { key: 'ref', label: 'Bill / advance', type: 'text' }, { key: 'bank', label: 'Bank', type: 'text' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'st', label: 'Line', type: 'text' }], rows: v.lines.map((l) => ({ n: l.lineNo, payee: l.payee, kind: l.kindLabel, ref: l.billDoc ?? l.advanceDoc ?? l.purpose ?? '', bank: l.bank ?? (v.payMode === 'CHEQUE' ? 'Cheque' : ''), amount: l.amount, st: l.status })), footer: [`${v.docNo} · ${v.payMode} from ${v.bank?.name ?? ''} on ${v.payDate} · ${v.statusLabel} · ${v.runLabel} · total ${money(paise(v.total))}`], title: `Payment proposal ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf` }; },
  };

  // ---- FR-03: the payment run ----
  const records = (actor, r, bank, pays) => pays.map((p, i) => {
    const l = db.prepare('SELECT * FROM pmt_proposal_lines WHERE id = ?').get(p.line_id); const full = partnersOf(db)?.banks?.reveal(actor, l.partner_id, l.partner_bank_id);
    if (!full) throw unprocessable('The partner register is not available to read the bank account.');
    const email = db.prepare("SELECT email FROM mdm_partner_contacts WHERE partner_id = ? AND email IS NOT NULL AND deleted_at IS NULL ORDER BY is_primary DESC, id LIMIT 1").get(l.partner_id)?.email ?? '';
    return { seq: i + 1, mode: r.pay_mode, amountPaise: p.amount_paise, valueDate: r.pay_date, beneficiaryName: full.accountName, accountNo: String(full.accountNo).replace(/\s/g, ''), ifsc: full.ifsc, reference: p.doc_no.replaceAll('/', ''), debitAccount: vault.decrypt(bank.account_no_enc, slot(bank.company_id, bank.code)), email, purpose: (l.purpose ?? LINE_KINDS[l.line_kind]).slice(0, 30) };
  });
  function bankFile(actor, r) {
    const bank = bankRow(r.company_id, r.bank_account_id); const t = templateOf(bank);
    const pays = db.prepare("SELECT * FROM pmt_payments WHERE proposal_id = ? AND pay_status != 'CANCELLED' ORDER BY id").all(r.id);
    const recs = records(actor, r, bank, pays); const text = buildBankFile(t, recs);
    const problems = validateBankFile(t, text, { count: recs.length, totalPaise: recs.reduce((a, x) => a + x.amountPaise, 0) });
    if (problems.length) throw unprocessable(`The bank file did not pass its check, so it is not given: ${problems.join(' ')}`);
    return { text, hash: createHash('sha256').update(text).digest('hex'), name: `${r.doc_no.replaceAll('/', '-')}-${bank.code}-${r.pay_mode}.${t.delimiter === ',' ? 'csv' : 'txt'}` };
  }
  function postPayment(actor, p, l, bank) {
    const dims = l.project_id ? { projectId: l.project_id } : {};
    const debit = l.line_kind === 'ADVANCE' ? { accountId: acct(p.company_id, '160001'), debit: rs(p.amount_paise), partnerId: p.partner_id, ...dims } : { accountId: apAccount(p.company_id, p.partner_id), debit: rs(p.amount_paise), partnerId: p.partner_id, ...dims };
    return gl.postEngine(p.company_id, { voucherType: 'PV', date: p.released_on, narration: `Payment ${p.doc_no} to ${p.payee_name} by ${p.pay_mode}${p.cheque_no ? ` cheque ${p.cheque_no}` : ''}: ${l.line_kind === 'BILL' ? `bill ${l.source_id}` : LINE_KINDS[l.line_kind]}`.slice(0, 500), sourceType: 'pmt_payments', sourceId: p.id, lines: [debit, { accountId: bank.gl_account_id, credit: rs(p.amount_paise) }], user: actor.user }).journal.id;
  }
  const run = {
    /** Release (FR-03, FR-05): by a third person; every line checked again; the payments made, posted and announced; the bank file checked, or the cheques numbered. */
    release(actor, id) {
      need(actor, 'fin.payment.release', 'release payment runs'); const r = proposalRow(actor, id);
      if (r.status !== 'APPROVED') throw conflict('Only an approved proposal is released.');
      if (r.run_status !== 'NONE') throw conflict(`${r.doc_no} was released already (${r.released_at?.slice(0, 16).replace('T', ' ')} by ${r.released_by}).`);
      const sod = sodOf(actor, r); if (sod) throw forbidden(sod);
      const bank = bankRow(r.company_id, r.bank_account_id); if (!bank || bank.acct_status !== 'ACTIVE') throw unprocessable('The bank account of the proposal is blocked.');
      const lines = db.prepare("SELECT * FROM pmt_proposal_lines WHERE proposal_id = ? AND line_status = 'PROPOSED' AND deleted_at IS NULL ORDER BY line_no").all(r.id);
      if (!lines.length) throw unprocessable('The proposal has no lines left to pay.');
      // BR-01 and FR-05 again at release: a bank changed, a hold or a payment made since the approval stops the line
      const problems = lines.flatMap((l, i) => { const c = checkLine(r.company_id, { kind: l.line_kind, billId: l.ap_bill_id, advanceId: l.advance_id, partnerId: l.partner_id, projectId: l.project_id, amount: l.amount_paise / 100, purpose: l.purpose }, r.pay_mode, r.id, i); const x = [...c.problems.map((p) => `Line ${l.line_no} (${l.payee_name}): ${p.message}`)]; if (r.pay_mode !== 'CHEQUE' && c.v?.bankId && c.v.bankId !== l.partner_bank_id) x.push(`Line ${l.line_no} (${l.payee_name}): the bank account changed after the approval.`); return x; });
      if (problems.length) throw conflict(`Nothing was released. Take these lines out (or return the proposal) and release again: ${problems.join(' ')}`);
      if (r.pay_mode === 'CHEQUE' && (bank.cheque_next_no == null || bank.cheque_next_no + lines.length - 1 > bank.cheque_last_no)) throw unprocessable(`${bank.name} has ${bank.cheque_next_no == null ? 0 : bank.cheque_last_no - bank.cheque_next_no + 1} cheque(s) left in its book; ${lines.length} are needed.`);
      return transaction(db, () => {
        const today = todayIST(); let cheque = bank.cheque_next_no; const made = [];
        for (const l of lines) {
          const no = docNo(r.company_id, 'pmt_payments', 'PAY');
          const pid = Number(db.prepare("INSERT INTO pmt_payments (company_id, doc_no, proposal_id, line_id, partner_id, payee_name, pay_mode, bank_account_id, amount_paise, cheque_no, released_on, pay_status, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'pmt_proposals', ?)")
            .run(r.company_id, no, r.id, l.id, l.partner_id, l.payee_name, r.pay_mode, bank.id, l.amount_paise, r.pay_mode === 'CHEQUE' ? String(cheque) : null, today, l.project_id ?? null, actor.user, String(r.id)).lastInsertRowid);
          if (r.pay_mode === 'CHEQUE') cheque += 1;
          const p = db.prepare('SELECT * FROM pmt_payments WHERE id = ?').get(pid); const jid = postPayment(actor, p, l, bank);
          db.prepare('UPDATE pmt_payments SET journal_id = ? WHERE id = ?').run(jid, pid);
          db.prepare("UPDATE pmt_proposal_lines SET line_status = 'RELEASED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), l.id);
          publishEvent(db, { type: 'fin.payment.released', entity: 'pmt_payments', entityId: pid, actorId: actor.user, companyId: r.company_id, data: { paymentId: pid, docNo: no, proposalId: r.id, proposalNo: r.doc_no, kind: l.line_kind, billId: l.ap_bill_id, advanceId: l.advance_id, partnerId: l.partner_id, amount: rs(l.amount_paise), mode: r.pay_mode, chequeNo: p.cheque_no, journalId: jid, releasedOn: today } });
          made.push(p);
        }
        if (r.pay_mode === 'CHEQUE') db.prepare('UPDATE fin_bank_accounts SET cheque_next_no = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(cheque, actor.user, nowIso(), bank.id);
        let file = null; if (r.pay_mode !== 'CHEQUE') file = bankFile(actor, { ...r });
        db.prepare("UPDATE pmt_proposals SET run_status = 'RELEASED', released_by = ?, released_at = ?, file_name = ?, file_hash = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), file?.name ?? null, file?.hash ?? null, actor.user, nowIso(), r.id);
        audit(actor, 'pmt_proposals', r.id, 'release', r.company_id, { newValues: { payments: made.length, total: rs(made.reduce((a, p) => a + p.amount_paise, 0)), file: file?.name ?? null, cheques: r.pay_mode === 'CHEQUE' ? `${bank.cheque_next_no}-${cheque - 1}` : null } });
        notify(r.company_id, 'fin.payment.decided', [`user:${r.requested_by}`], r.doc_no, 'released', `${r.doc_no} was released by ${actor.user}: ${made.length} payment(s). Enter the bank's confirmation when it comes.`, `/finance/payment-proposals?id=${r.id}`, r.id);
        return proposals.get(actor, r.id);
      });
    },
    /** The bank file again (the same file: its hash is checked against the one made at release). Every download is in the audit trail. */
    file(actor, id) {
      need(actor, 'fin.payment.release', 'download bank files'); const r = proposalRow(actor, id);
      if (r.run_status === 'NONE' || r.pay_mode === 'CHEQUE') throw unprocessable('A bank file exists for a released transfer run only.');
      const f = bankFile(actor, r); if (r.file_hash && f.hash !== r.file_hash && !db.prepare("SELECT 1 FROM pmt_payments WHERE proposal_id = ? AND pay_status = 'CANCELLED'").get(r.id)) throw conflict('The bank file would differ from the one made at release (a bank account changed since). Take the bank\'s confirmation of what was sent instead.');
      audit(actor, 'pmt_proposals', r.id, 'download_file', r.company_id, { reason: f.name });
      return { contentType: 'text/plain; charset=utf-8', fileName: f.name, buffer: Buffer.from(f.text, 'utf8') };
    },
    /** The cheques of a cheque run, to print (A/c payee, the amount in figures and in words). */
    cheques(actor, id) {
      need(actor, 'fin.payment.print', 'print cheques'); const r = proposalRow(actor, id); if (r.run_status === 'NONE' || r.pay_mode !== 'CHEQUE') throw unprocessable('Cheques are printed for a released cheque run.');
      const pays = db.prepare("SELECT * FROM pmt_payments WHERE proposal_id = ? ORDER BY cheque_no").all(r.id); audit(actor, 'pmt_proposals', r.id, 'print_cheques', r.company_id, { reason: `${pays.length} cheque(s)` });
      return { buffer: toPdf({ columns: [{ key: 'no', label: 'Cheque', type: 'text' }, { key: 'date', label: 'Date', type: 'text' }, { key: 'payee', label: 'Pay (A/c payee only)', type: 'text' }, { key: 'amt', label: 'Rupees', type: 'text' }, { key: 'words', label: 'In words', type: 'text' }, { key: 'st', label: 'Status', type: 'text' }], rows: pays.map((p) => ({ no: p.cheque_no, date: fmtDate(r.pay_date, 'DD/MM/YYYY'), payee: p.payee_name, amt: (p.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }), words: amountInWords(p.amount_paise / 100), st: PAY_STATUS[p.pay_status] })), footer: [`${r.doc_no} · ${bankRow(r.company_id, r.bank_account_id)?.name ?? ''}`], title: `Cheques of ${r.doc_no}` }), contentType: 'application/pdf', fileName: `cheques-${r.doc_no.replaceAll('/', '-')}.pdf` };
    },
  };

  // ---- the bank's confirmation (UTR, cheque cleared), a return or a cancelled cheque ----
  function settleProposal(proposalId) {
    const c = db.prepare("SELECT SUM(CASE WHEN pay_status = 'PENDING' THEN 1 ELSE 0 END) AS open, COUNT(*) AS n FROM pmt_payments WHERE proposal_id = ?").get(proposalId);
    db.prepare('UPDATE pmt_proposals SET run_status = ?, version = version + 1 WHERE id = ?').run(c.open === 0 ? 'CONFIRMED' : c.open < c.n ? 'PART_CONFIRMED' : 'RELEASED', proposalId);
  }
  function advice(actor, p) {
    const contact = db.prepare("SELECT email FROM mdm_partner_contacts WHERE partner_id = ? AND email IS NOT NULL AND deleted_at IS NULL ORDER BY is_primary DESC, id LIMIT 1").get(p.partner_id);
    const l = db.prepare('SELECT l.*, b.doc_no AS bill_doc, b.bill_no, b.bill_date, b.total_paise AS bill_total, b.tds_paise AS bill_tds, b.tds_section FROM pmt_proposal_lines l LEFT JOIN ap_bills b ON b.id = l.ap_bill_id WHERE l.id = ?').get(p.line_id);
    const body = [`Dear ${p.payee_name},`, '', `We have paid you ${money(p.amount_paise)} by ${p.pay_mode}${p.utr ? ` (UTR ${p.utr})` : ''}${p.cheque_no ? ` (cheque ${p.cheque_no})` : ''} on ${p.paid_on}.`, l.line_kind === 'BILL' ? `For your bill ${l.bill_no ?? ''} of ${l.bill_date} (our ref ${l.bill_doc}): bill ${money(l.bill_total)}, TDS deducted ${money(l.bill_tds)}${l.tds_section ? ` under ${l.tds_section}` : ''}, paid now ${money(p.amount_paise)}.` : l.line_kind === 'ADVANCE' ? 'This is an advance against your contract.' : `On account: ${l.purpose ?? ''}.`, '', `Payment reference ${p.doc_no}.`].join('\n');
    if (!contact?.email) return { status: 'NO_ADDRESS', id: null };
    const res = commOf(db).send({ companyId: p.company_id, channel: 'EMAIL', to: contact.email, subject: `Payment advice ${p.doc_no}: ${money(p.amount_paise)}`, body, purpose: 'TRANSACTIONAL', related: { entity: 'pmt_payments', id: p.id }, contact: { type: isSub(p.partner_id) ? 'SUBCONTRACTOR' : 'VENDOR', id: p.partner_id }, actor: actor.user });
    return { status: res.status === 'BLOCKED' ? `BLOCKED: ${res.blockReason}` : res.status, id: res.id };
  }
  function confirmOne(actor, row) {
    const p = row.paymentId ? db.prepare('SELECT * FROM pmt_payments WHERE id = ? AND company_id = ?').get(Number(row.paymentId), actor.companyId) : db.prepare('SELECT * FROM pmt_payments WHERE doc_no = ? AND company_id = ?').get(String(row.docNo ?? '').trim(), actor.companyId);
    if (!p) return { ref: row.paymentId ?? row.docNo, ok: false, message: 'No such payment.' };
    if (p.pay_status !== 'PENDING') return p.pay_status === row.status && (row.status !== 'PAID' || !row.utr || row.utr === p.utr) ? { ref: p.doc_no, ok: true, message: 'Already recorded.', unchanged: true } : { ref: p.doc_no, ok: false, message: `${p.doc_no} is ${PAY_STATUS[p.pay_status].toLowerCase()} already.` };
    const bank = bankRow(p.company_id, p.bank_account_id); const l = db.prepare('SELECT * FROM pmt_proposal_lines WHERE id = ?').get(p.line_id);
    if (row.status === 'PAID') {
      const utr = row.utr ? String(row.utr).trim().toUpperCase() : null;
      if (p.pay_mode !== 'CHEQUE' && (!utr || !UTR.test(utr))) return { ref: p.doc_no, ok: false, message: 'A UTR is 12 to 22 letters and digits.' };
      if (utr && db.prepare('SELECT doc_no FROM pmt_payments WHERE company_id = ? AND utr = ? AND id != ?').get(p.company_id, utr, p.id)) return { ref: p.doc_no, ok: false, message: `UTR ${utr} is already recorded for another payment.` };
      if (!row.paidOn || row.paidOn < p.released_on) return { ref: p.doc_no, ok: false, message: 'The date paid is on or after the release.' };
      db.prepare("UPDATE pmt_payments SET pay_status = 'PAID', utr = ?, paid_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(utr, row.paidOn, actor.user, nowIso(), p.id);
      db.prepare("UPDATE pmt_proposal_lines SET line_status = 'PAID', version = version + 1 WHERE id = ?").run(l.id);
      const adv = advice(actor, db.prepare('SELECT * FROM pmt_payments WHERE id = ?').get(p.id));
      db.prepare('UPDATE pmt_payments SET advice_at = ?, advice_status = ?, advice_message_id = ? WHERE id = ?').run(nowIso(), adv.status, adv.id, p.id);
      audit(actor, 'pmt_payments', p.id, 'confirm', p.company_id, { newValues: { utr, paidOn: row.paidOn, advice: adv.status } });
      publishEvent(db, { type: 'fin.payment.confirmed', entity: 'pmt_payments', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { paymentId: p.id, docNo: p.doc_no, partnerId: p.partner_id, amount: rs(p.amount_paise), utr, chequeNo: p.cheque_no, paidOn: row.paidOn, bankAccountId: bank.id } });
    } else {
      if (!row.reason) return { ref: p.doc_no, ok: false, message: 'Say why the bank returned it, or why the cheque is cancelled.' };
      const to = row.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      if (to === 'CANCELLED' && p.pay_mode !== 'CHEQUE') return { ref: p.doc_no, ok: false, message: 'A transfer the bank does not make is entered as returned, not cancelled.' };
      const rev = gl.reverseEngine(p.company_id, p.journal_id, { date: todayIST(), reason: `${to === 'CANCELLED' ? 'Cheque cancelled' : 'Returned by the bank'}: ${row.reason}`.slice(0, 200), user: actor.user });
      db.prepare('UPDATE pmt_payments SET pay_status = ?, failure_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, row.reason, actor.user, nowIso(), p.id);
      db.prepare("UPDATE pmt_proposal_lines SET line_status = 'FAILED', remarks = ?, version = version + 1 WHERE id = ?").run(row.reason, l.id);
      audit(actor, 'pmt_payments', p.id, to === 'CANCELLED' ? 'cancel' : 'fail', p.company_id, { reason: row.reason, newValues: { reversal: rev?.journal?.id ?? rev?.id ?? null } });
      publishEvent(db, { type: 'fin.payment.failed', entity: 'pmt_payments', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { paymentId: p.id, docNo: p.doc_no, kind: l.line_kind, billId: l.ap_bill_id, advanceId: l.advance_id, partnerId: p.partner_id, amount: rs(p.amount_paise), reason: row.reason, chequeNo: p.cheque_no } });
      notify(p.company_id, 'fin.payment.alert', ['permission:fin.payment.release'], p.doc_no, to === 'CANCELLED' ? 'cheque cancelled' : 'returned by the bank', `${p.doc_no} to ${p.payee_name} (${money(p.amount_paise)}) ${to === 'CANCELLED' ? 'cheque cancelled' : 'was returned by the bank'}: ${row.reason}. It is reversed; the bill can be proposed again.`, `/finance/payments?id=${p.id}`, p.id);
    }
    settleProposal(p.proposal_id);
    return { ref: p.doc_no, ok: true, message: row.status === 'PAID' ? 'Paid' : 'Reversed' };
  }
  /** A line of the bank's response file: Payment, UTR, Date paid, Status (PAID / FAILED), Reason. */
  function parseResponse(csv) {
    const rows = String(csv ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,|\t]/).map((x) => x.trim().replace(/^"|"$/g, '')));
    if (!rows.length) throw badRequest('Correct the highlighted fields', [{ field: 'csv', message: 'The file is empty.' }]);
    const head = rows[0].map((h) => h.toLowerCase()); const hasHead = head.some((h) => /payment|reference|utr/.test(h)); const body = hasHead ? rows.slice(1) : rows;
    const at = (names, def) => { const i = head.findIndex((h) => names.some((n) => h.includes(n))); return hasHead && i >= 0 ? i : def; };
    const iRef = at(['payment', 'reference', 'ref'], 0); const iUtr = at(['utr'], 1); const iDate = at(['date'], 2); const iSt = at(['status'], 3); const iWhy = at(['reason', 'remark'], 4);
    const toDate = (d) => (/^\d{2}\/\d{2}\/\d{4}$/.test(d) ? `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : d);
    return body.map((f) => { const ref = f[iRef] ?? ''; const st = String(f[iSt] ?? 'PAID').toUpperCase(); return { docNo: /^PAY\d{6}$/i.test(ref) ? `PAY/${ref.slice(3)}` : ref, utr: f[iUtr] || null, paidOn: toDate(f[iDate] ?? ''), status: ['SUCCESS', 'PAID', 'PROCESSED', 'COMPLETED'].includes(st) ? 'PAID' : 'FAILED', reason: f[iWhy] || (['SUCCESS', 'PAID', 'PROCESSED', 'COMPLETED'].includes(st) ? null : st) }; });
  }
  const payments = {
    list(actor, query) { need(actor, 'fin.payment.view', 'see payments'); return runList(db, paymentList, parseListRequest(paymentList, query), { select: 'x.*', scopeSql: '1 = 1', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => paymentView(actor, r) }); },
    get(actor, id) { need(actor, 'fin.payment.view', 'see payments'); const p = db.prepare('SELECT * FROM pmt_payments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!p) throw notFound('That payment does not exist.'); return paymentView(actor, p, true); },
    /** The confirmation of payments: rows entered on the page, or the bank's response file. Each row stands alone: one wrong row does not stop the others. */
    confirm(actor, { rows, csv }) {
      need(actor, 'fin.payment.confirm', 'enter the bank\'s confirmation'); const list = rows ?? parseResponse(csv);
      if (list.length > 500) throw badRequest('Correct the highlighted fields', [{ field: 'rows', message: 'At most 500 payments at a time.' }]);
      const results = list.map((row) => { try { return transaction(db, () => confirmOne(actor, row)); } catch (x) { return { ref: row.paymentId ?? row.docNo, ok: false, message: x.message }; } });
      return { results, paid: results.filter((x) => x.ok && x.message === 'Paid').length, reversed: results.filter((x) => x.ok && x.message === 'Reversed').length, failed: results.filter((x) => !x.ok).length };
    },
    adviceAgain(actor, id) {
      need(actor, 'fin.payment.confirm', 'send payment advices'); const p = db.prepare("SELECT * FROM pmt_payments WHERE id = ? AND company_id = ? AND pay_status = 'PAID'").get(rid(id), actor.companyId); if (!p) throw unprocessable('An advice goes for a paid payment.');
      const adv = advice(actor, p); db.prepare('UPDATE pmt_payments SET advice_at = ?, advice_status = ?, advice_message_id = ? WHERE id = ?').run(nowIso(), adv.status, adv.id, p.id); audit(actor, 'pmt_payments', p.id, 'advice', p.company_id, { newValues: { advice: adv.status } }); return payments.get(actor, p.id);
    },
    advicePdf(actor, id) {
      need(actor, 'fin.payment.print', 'print payment advices'); const v = payments.get(actor, id); audit(actor, 'pmt_payments', v.id, 'print', actor.companyId);
      const rows = [['Payee', v.payee], ['Paid', `${money(paise(v.amount))} by ${v.mode}`], ['UTR / cheque', v.utr ?? v.chequeNo ?? ''], ['Date', v.paidOn ?? v.releasedOn], ['In words', amountInWords(v.amount)], ...(v.bill ? [['Your bill', `${v.bill.billNo ?? ''} of ${v.bill.billDate}`], ['Our reference', v.bill.docNo], ['Bill amount', money(paise(v.bill.total))], ['TDS deducted', `${money(paise(v.bill.tds))} ${v.bill.tdsSection ?? ''}`.trim()], ['Paid against it (all payments)', money(paise(v.bill.paid))]] : []), ['Payment reference', v.docNo]].map(([k, val]) => ({ k, v: String(val ?? '') }));
      return { buffer: toPdf({ columns: [{ key: 'k', label: '', type: 'text' }, { key: 'v', label: '', type: 'text' }], rows, footer: ['Payment advice'], title: `Payment advice ${v.docNo}` }), contentType: 'application/pdf', fileName: `advice-${v.docNo.replaceAll('/', '-')}.pdf` };
    },
    exportCsv(actor, query = {}) { need(actor, 'fin.payment.export', 'export payments'); const l = payments.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'pmt_payments', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `payments-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Payment', 'Payee', 'For', 'Mode', 'Amount', 'Released', 'Paid on', 'UTR', 'Cheque', 'From bank', 'Proposal', 'Status'], l.data.map((x) => [x.docNo, x.payee, x.kindLabel, x.mode, x.amount, x.releasedOn, x.paidOn ?? '', x.utr ?? '', x.chequeNo ?? '', x.bank, x.proposalNo, x.statusLabel]))}`, 'utf8') }; },
    /** The cheque register of a bank account: every cheque issued from its series, with its state. */
    chequeRegister(actor, { bankAccountId }) {
      need(actor, 'fin.payment.view', 'see the cheque register'); const b = bankRow(actor.companyId, bankAccountId); if (!b) throw notFound('That bank account does not exist.');
      const rows = db.prepare("SELECT p.*, pr.doc_no AS proposal_no FROM pmt_payments p JOIN pmt_proposals pr ON pr.id = p.proposal_id WHERE p.company_id = ? AND p.bank_account_id = ? AND p.cheque_no IS NOT NULL ORDER BY CAST(p.cheque_no AS INTEGER)").all(actor.companyId, b.id)
        .map((p) => ({ id: p.id, chequeNo: p.cheque_no, docNo: p.doc_no, proposalNo: p.proposal_no, payee: p.payee_name, amount: rs(p.amount_paise), issued: p.released_on, cleared: p.paid_on, status: p.pay_status, statusLabel: p.pay_status === 'PENDING' ? 'Issued' : p.pay_status === 'PAID' ? 'Cleared' : p.pay_status === 'CANCELLED' ? 'Cancelled' : PAY_STATUS[p.pay_status], reason: p.failure_reason }));
      return { bank: { id: b.id, name: b.name, next: b.cheque_next_no, last: b.cheque_last_no, left: b.cheque_next_no != null ? Math.max(0, b.cheque_last_no - b.cheque_next_no + 1) : 0 }, rows, issued: rows.filter((r) => r.status === 'PENDING').length, cleared: rows.filter((r) => r.status === 'PAID').length, cancelled: rows.filter((r) => r.status === 'CANCELLED').length };
    },
  };
  function paymentView(actor, p, detail = false) {
    const l = db.prepare('SELECT * FROM pmt_proposal_lines WHERE id = ?').get(p.line_id); const pr = db.prepare('SELECT doc_no FROM pmt_proposals WHERE id = ?').get(p.proposal_id); const b = bankRow(p.company_id, p.bank_account_id);
    const o = { id: p.id, docNo: p.doc_no, proposalId: p.proposal_id, proposalNo: pr?.doc_no, kind: l?.line_kind, kindLabel: LINE_KINDS[l?.line_kind], partnerId: p.partner_id, payee: p.payee_name, mode: p.pay_mode, bank: b?.name, amount: rs(p.amount_paise), releasedOn: p.released_on, paidOn: p.paid_on, utr: p.utr, chequeNo: p.cheque_no, status: p.pay_status, statusLabel: PAY_STATUS[p.pay_status], failureReason: p.failure_reason, journalId: p.journal_id, adviceAt: p.advice_at, adviceStatus: p.advice_status,
      can: { confirm: p.pay_status === 'PENDING' && may(actor, 'fin.payment.confirm'), advice: p.pay_status === 'PAID' && may(actor, 'fin.payment.confirm'), print: may(actor, 'fin.payment.print') } };
    if (detail) {
      const bill = l?.ap_bill_id ? db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(l.ap_bill_id) : null;
      o.bill = bill ? { id: bill.id, docNo: bill.doc_no, billNo: bill.bill_no, billDate: bill.bill_date, total: rs(bill.total_paise), tds: rs(bill.tds_paise), tdsSection: bill.tds_section, paid: rs(bill.paid_paise) } : null;
      o.advance = l?.advance_id ? db.prepare('SELECT id, doc_no AS docNo, adv_type AS type FROM bill_advances WHERE id = ?').get(l.advance_id) : null;
      o.purpose = l?.purpose; o.bankAccount = l?.bank_last4 ? `••••${l.bank_last4} ${l.bank_ifsc}` : null;
      o.history = db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'pmt_payments' AND entity_id = ? ORDER BY id").all(String(p.id));
    }
    return o;
  }

  return { banks, proposals, run, payments, candidates: proposals.candidates, checkLine };
}
