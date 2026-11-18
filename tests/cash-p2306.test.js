import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { todayIST } from '../src/shared/dates.js';
import { parseCsvStatement, parseMt940 } from '../src/server/modules/fin/cash.js';

// Part 23.06: cash and bank.
//  T-01 the automatic match finds at least 90 % of a sample statement (by our reference in the bank's narration, the UTR, the cheque number, or the amount within the
//  days when one entry fits) and the reconciliation statement balances (book + unpresented − uncredited − bank-only debits + bank-only credits = the bank).
//  and: a statement imported twice takes no line twice; MT940; a payment pending at the bank is confirmed by its match (23.04); bank charges and interest posted; the BRS
//  signed off by the accounts manager only when it balances; an imprest funded by a contra, vouchers within the band approved at once and above it by the construction
//  manager, a voucher above the cash in hand refused and one without its bill photo held back (BR-01), the replenishment through the project manager and the accounts
//  manager for the approved vouchers only, a cash count with its difference; the daily position; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), sacc: as('SACC', 'sacc1'), cm: as('CM', 'cm1'), pm: as('PM', 'pm1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const today = todayIST();
const d = (n) => { const x = new Date('2026-10-01T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const db = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  const bank = await call(U.cfo, 'POST', '/bank-accounts', { code: 'HDFC-CA', name: 'HDFC current account', bankName: 'HDFC Bank', ifsc: 'HDFC0000001', accountNo: '50200012345678', glAccountId: acct('150002'), fileFormat: 'GENERIC_CSV', chequeFrom: 300001, chequeTo: 300100 });
  assert.equal(bank.status, 201, JSON.stringify(bank.json)); const bankId = bank.json.data.id;
  assert.equal((await call(U.cfo, 'PUT', `/bank-profiles/${bankId}`, { kind: 'CURRENT', scope: 'COMPANY', openingDate: '2026-10-01', opening: 0 })).status, 200);
  return { ...r, call, acct, bankId, db };
}

test('T-01 the automatic match finds ≥ 90 % of a sample statement; the BRS balances and is signed off', async () => {
  const w = await world(); const db = w.db;
  const vendor = fill(db, 'mdm_partners', { company_id: 1, code: 'V1', legal_name: 'Deccan Cement Traders Pvt Ltd', partner_status: 'ACTIVE' });
  const client = fill(db, 'mdm_partners', { company_id: 1, code: 'C1', legal_name: 'Telangana Housing Board', partner_status: 'ACTIVE' });
  const prop = fill(db, 'pmt_proposals', { company_id: 1, doc_no: 'PP/000001', bank_account_id: w.bankId, pay_mode: 'NEFT', pay_date: d(0), status: 'APPROVED', run_status: 'RELEASED' });
  let n = 0;
  const pay = (day, amount, o = {}) => { n += 1; const line = fill(db, 'pmt_proposal_lines', { company_id: 1, proposal_id: prop, line_no: n, line_kind: 'ON_ACCOUNT', partner_id: vendor, payee_name: 'Deccan Cement Traders Pvt Ltd', amount_paise: amount * 100, line_status: 'RELEASED' }); return fill(db, 'pmt_payments', { company_id: 1, doc_no: `PAY/${String(n).padStart(6, '0')}`, proposal_id: prop, line_id: line, partner_id: vendor, payee_name: 'Deccan Cement Traders Pvt Ltd', pay_mode: o.cheque ? 'CHEQUE' : 'NEFT', bank_account_id: w.bankId, amount_paise: amount * 100, cheque_no: o.cheque ?? null, released_on: d(day), pay_status: 'PENDING' }); };
  const rec = (day, amount, ref) => fill(db, 'ar_receipts', { company_id: 1, doc_no: `RCPT/${ref}`, partner_id: client, receipt_date: d(day), bank_account_id: w.bankId, reference: ref, amount_paise: amount * 100, status: 'APPROVED' });
  // the books: 7 transfers, 2 cheques (one not presented), 8 receipts (one not credited)
  const pays = [pay(1, 118000), pay(2, 45000), pay(3, 9900), pay(4, 250000), pay(5, 76540), pay(6, 12000), pay(7, 33333)];
  const chq1 = pay(8, 54000, { cheque: '300001' }); const chqLate = pay(9, 22000, { cheque: '300002' });
  const recs = [rec(1, 500000, 'UTR SBIN526001'), rec(2, 120000, 'SBIN526002XYZ'), rec(3, 75000, 'NEFT TSHB 526003'), rec(4, 300000, 'RTGS SBINR526004'), rec(5, 64000, 'SBIN526005QQ'), rec(6, 88000, 'SBIN526006AB'), rec(7, 99000, 'SBIN526007CD'), rec(11, 15000, 'SBIN526011EF'), rec(12, 27500, 'SBIN526012GH'), rec(12, 6400, 'SBIN526013JK')];
  const recLate = rec(10, 41000, 'SBIN526099ZZ');
  // the statement: 20 lines — 18 of the books (6 transfers by our reference in the narration, one by the amount and the date, one cheque, 9 receipts by their UTR,
  // one receipt by the amount and the date) and 2 the bank's alone (bank charges, interest)
  let bal = 0; const L = [];
  const add = (day, desc, ref, chq, dr, cr) => { bal += cr - dr; L.push([d(day), d(day), desc, ref ?? '', chq ?? '', dr ? dr.toFixed(2) : '', cr ? cr.toFixed(2) : '', bal.toFixed(2)].join(',')); };
  add(1, 'NEFT CR TSHB UTR SBIN526001', 'SBIN526001', '', 0, 500000);
  add(1, 'NEFT DR DECCAN CEMENT PAY000001', 'HDFCN52610100000', '', 118000, 0);
  add(2, 'NEFT DR DECCAN PAY000002', 'HDFCN52610200000', '', 45000, 0);
  add(2, 'RTGS CR SBIN526002XYZ', 'SBIN526002XYZ', '', 0, 120000);
  add(3, 'NEFT DR PAY000003 DECCAN', 'HDFCN52610300000', '', 9900, 0);
  add(3, 'NEFT CR TSHB 526003', 'NEFTTSHB526003', '', 0, 75000);
  add(4, 'RTGS DR PAY000004', 'HDFCR52610400000', '', 250000, 0);
  add(4, 'RTGS CR SBINR526004', 'SBINR526004', '', 0, 300000);
  add(5, 'NEFT DR PAY000005', 'HDFCN52610500000', '', 76540, 0);
  add(5, 'NEFT CR SBIN526005QQ', 'SBIN526005QQ', '', 0, 64000);
  add(6, 'NEFT DR PAY000006', 'HDFCN52610600000', '', 12000, 0);
  add(6, 'NEFT CR SBIN526006AB', 'SBIN526006AB', '', 0, 88000);
  add(8, 'NEFT DR BULK PAYMENT', 'HDFCN52610700000', '', 33333, 0);
  add(7, 'NEFT CR SBIN526007CD', 'SBIN526007CD', '', 0, 99000);
  add(9, 'CHQ PAID 300001', '', '300001', 54000, 0);
  add(10, 'BANK CHARGES NEFT', '', '', 590, 0);
  add(11, 'INTEREST CREDIT', '', '', 0, 1250);
  add(11, 'NEFT CR SBIN526011EF', 'SBIN526011EF', '', 0, 15000);
  add(12, 'IMPS CR SBIN526012GH', 'SBIN526012GH', '', 0, 27500);
  add(13, 'NEFT CR 526013JK', '', '', 0, 6400);
  const csv = `Txn Date,Value Date,Narration,Ref No,Cheque No,Withdrawal,Deposit,Balance\n${L.join('\n')}`;
  assert.equal((await w.call(U.se, 'POST', '/bank-statements/import', { bankAccountId: w.bankId, fileName: 'hdfc-oct.csv', content: csv })).status, 403);
  const im = await w.call(U.fin, 'POST', '/bank-statements/import', { bankAccountId: w.bankId, fileName: 'hdfc-oct.csv', content: csv }); assert.equal(im.status, 201, JSON.stringify(im.json));
  assert.equal(im.json.data.lines, 20);
  // 18 of the 20 lines are matched by themselves (90 %); the bank charges and the interest are the bank's alone
  const ls = (await w.call(U.fin, 'GET', `/bank-statements?bankAccountId=${w.bankId}`)).json.data; const byDesc = (s) => ls.rows.find((x) => x.description === s);
  assert.equal(im.json.data.matched, 18); assert.ok(im.json.data.matched / im.json.data.lines >= 0.9, 'T-01: at least 90 % of the sample statement'); assert.equal(ls.autoRate, 90);
  assert.equal(byDesc('NEFT CR 526013JK').rule, 'AMOUNT_DATE', 'no reference in the narration: the amount within the days');
  assert.equal(byDesc('NEFT DR BULK PAYMENT').rule, 'AMOUNT_DATE'); assert.equal(byDesc('CHQ PAID 300001').rule, 'CHEQUE'); assert.equal(byDesc('NEFT DR DECCAN PAY000002').rule, 'REFERENCE');
  void pays; void recs;
  // a payment pending at the bank is confirmed by the match (23.04)
  assert.equal(db.prepare('SELECT pay_status FROM pmt_payments WHERE id = ?').get(pays[1]).pay_status, 'PAID');
  // a second import of the same file takes no line twice
  const again = await w.call(U.fin, 'POST', '/bank-statements/import', { bankAccountId: w.bankId, fileName: 'hdfc-oct.csv', content: csv }); assert.equal(again.json.data.lines, 0); assert.equal(again.json.data.duplicates, 20);
  // the BRS before the four bank-only lines are dealt with: it explains the difference already
  let brs = (await w.call(U.fin, 'GET', `/brs?bankAccountId=${w.bankId}&asOf=${d(13)}`)).json.data;
  assert.equal(brs.unpresented.total, 22000, 'cheque 300002 not yet presented'); assert.equal(brs.uncredited.total, 41000, 'a receipt not yet credited');
  assert.equal(brs.bankOnly.debit, 590); assert.equal(brs.bankOnly.credit, 1250);
  assert.equal(brs.difference, 0, 'the BRS balances'); assert.equal(brs.statement, bal);
  // bank charges and interest posted; the rest set aside with a reason; matched by hand where it was the book's
  const charges = byDesc('BANK CHARGES NEFT');
  const noCc = await w.call(U.fin, 'POST', `/bank-statements/${charges.id}/post`, { accountId: w.acct('560005'), narration: 'Bank charges October' }); assert.equal(noCc.status, 400, 'the account\'s dimension rules are checked'); assert.match(JSON.stringify(noCc.json), /cost centre/); const interest = byDesc('INTEREST CREDIT');
  { const pc = await w.call(U.fin, 'POST', `/bank-statements/${charges.id}/post`, { accountId: w.acct('540001'), narration: 'Bank charges October' }); assert.equal(pc.status, 200, JSON.stringify(pc.json)); }
  assert.equal((await w.call(U.fin, 'POST', `/bank-statements/${interest.id}/post`, { accountId: w.acct('420001'), narration: 'Interest on current account' })).status, 200);
  brs = (await w.call(U.fin, 'GET', `/brs?bankAccountId=${w.bankId}&asOf=${d(13)}`)).json.data; assert.equal(brs.difference, 0); assert.equal(brs.bankOnly.debit, 0); assert.equal(brs.bankOnly.credit, 0);
  assert.equal(brs.book, bal - 22000 + 41000, 'the book: the bank less the cheque not presented, plus the receipt not credited');
  // signed off by the accounts manager, not by the finance executive
  assert.equal((await w.call(U.fin, 'POST', '/brs/sign', { bankAccountId: w.bankId, asOf: d(13) })).status, 403);
  const sg = await w.call(U.acc, 'POST', '/brs/sign', { bankAccountId: w.bankId, asOf: d(13) }); assert.equal(sg.status, 200, JSON.stringify(sg.json)); assert.ok(sg.json.data.signed);
  assert.equal((await w.call(U.acc, 'POST', `/bank-statements/${byDesc('NEFT CR 526013JK').id}/unmatch`, { reason: 'Reopen it' })).status, 409, 'a signed reconciliation covers it');
  void chq1; void chqLate; void recLate;
});

test('statement files: CSV in the bank\'s own layout; MT940 with its opening and closing; a wrong account is refused', async () => {
  const c = parseCsvStatement('Statement of account\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/2026,NEFT CR,SBIN1,01/10/2026,,"1,00,000.00","1,00,000.00"\n02-Oct-2026,CHQ 300001,300001,02/10/2026,"5,000.00",,"95,000.00"');
  assert.equal(c.lines.length, 2); assert.equal(c.lines[0].credit, 10000000); assert.equal(c.lines[1].txnDate, '2026-10-02'); assert.equal(c.closing, 9500000);
  const m = parseMt940(':20:STMT1\n:25:HDFC0000001/50200012345678\n:28C:1/1\n:60F:C261001INR100000,00\n:61:2610021002D5000,00NTRFPAY000001//HDFCN1\n:86:NEFT DR DECCAN CEMENT\n:61:2610031003C2500,50NTRFSBIN526001\n:86:NEFT CR TSHB\n:62F:C261003INR97500,50');
  assert.equal(m.lines.length, 2); assert.equal(m.opening, 10000000); assert.equal(m.closing, 9750050); assert.equal(m.lines[0].debit, 500000); assert.equal(m.lines[0].ref, 'PAY000001'); assert.equal(m.lines[1].balance, 9750050);
  const w = await world();
  const wrong = await w.call(U.fin, 'POST', '/bank-statements/import', { bankAccountId: w.bankId, fileName: 'x.sta', content: ':20:S\n:25:HDFC0000001/50200099999999\n:60F:C261001INR0,00\n:61:2610021002C10,00NTRFX\n:62F:C261002INR10,00' }); assert.equal(wrong.status, 422);
  const ok = await w.call(U.fin, 'POST', '/bank-statements/import', { bankAccountId: w.bankId, fileName: 'x.sta', content: ':20:S\n:25:HDFC0000001/50200012345678\n:60F:C261001INR0,00\n:61:2610021002C10,00NTRFX\n:62F:C261002INR10,00' }); assert.equal(ok.status, 201, JSON.stringify(ok.json));
});

test('FR-03 BR-01 an imprest: funded by a contra; vouchers within the band and above it; the cash in hand and the bill photo enforced; the replenishment; a cash count; the position; rights', async () => {
  const w = await world(); const db = w.db;
  const im = await w.call(U.acc, 'POST', '/imprests', { name: 'Tower A site imprest', kind: 'SITE', projectId: w.A, siteId: w.site, custodian: 'sacc1', limit: 50000 }); assert.equal(im.status, 201, JSON.stringify(im.json));
  const iid = im.json.data.id; assert.equal((await w.call(U.cm, 'POST', '/imprests', { name: 'x', custodian: 'sacc1', limit: 1000 })).status, 403);
  // FR-04: cash withdrawn from the bank into the imprest, approved by the accounts manager
  const k = await w.call(U.fin, 'POST', '/contras', { kind: 'WITHDRAWAL', date: today, fromBankId: w.bankId, toImprestId: iid, amount: 40000, reference: 'CHQ 300010', purpose: 'Float of the Tower A imprest' }); assert.equal(k.status, 201, JSON.stringify(k.json));
  const over = await w.call(U.fin, 'POST', '/contras', { kind: 'WITHDRAWAL', date: today, fromBankId: w.bankId, toImprestId: iid, amount: 60000, purpose: 'Too much' }); assert.equal(over.status, 400, 'above the limit');
  assert.equal((await w.call(U.fin, 'POST', `/contras/${k.json.data.id}/submit`)).status, 202); assert.equal((await w.act(U.acc, w.wf('fin_contras', k.json.data.id))).status, 200);
  assert.equal((await w.call(U.sacc, 'GET', `/imprests/${iid}`)).json.data.balance, 40000);
  const expense = w.acct('560004');
  const voucher = (amount, extra = {}) => w.call(U.sacc, 'POST', '/imprest-vouchers', { imprestId: iid, date: today, payee: 'Sri Rama Hardware', category: 'MATERIAL', description: 'Binding wire and nails', amount, expenseAccountId: expense, ...extra });
  const photo = (vid) => fill(db, 'core_files', { company_id: 1, storage_key: `k${vid}`, original_name: 'bill.jpg', extension: 'jpg', mime: 'image/jpeg', category: 'image', size_bytes: 1000, sha256: `h${vid}`, scan_status: 'CLEAN', linked_entity: 'fin_imprest_vouchers', linked_id: vid, version_no: 1, retention_class: 'standard' });
  assert.equal((await w.call(U.se, 'POST', '/imprest-vouchers', { imprestId: iid, date: today, payee: 'x', category: 'OTHER', description: 'xxx', amount: 10, expenseAccountId: expense })).status, 403);
  // within the band (≤ ₹10,000): approved and posted when sent
  const v1 = await voucher(2500, { gst: 0, clientRef: 'phone-1' }); assert.equal(v1.status, 201, JSON.stringify(v1.json));
  assert.equal((await voucher(2500, { clientRef: 'phone-1' })).json.data.id, v1.json.data.id, 'the same command from the phone makes one voucher');
  const noPhoto = await w.call(U.sacc, 'POST', `/imprest-vouchers/${v1.json.data.id}/submit`); assert.equal(noPhoto.status, 422); assert.match(noPhoto.json.error.message, /photo/);
  photo(v1.json.data.id); const s1 = await w.call(U.sacc, 'POST', `/imprest-vouchers/${v1.json.data.id}/submit`); assert.equal(s1.status, 202, JSON.stringify(s1.json)); assert.equal(s1.json.data.status, 'APPROVED');
  const jl = db.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ?').all(s1.json.data.journalId); assert.equal(jl.find((l) => l.account_id === expense).debit_paise, 250000); assert.equal(jl.find((l) => l.account_id === w.acct('150001')).credit_paise, 250000);
  // above the band: the construction manager approves
  const v2 = await voucher(12000, { category: 'REPAIRS', description: 'Repair of the mixer gearbox' }); photo(v2.json.data.id);
  assert.equal((await w.call(U.sacc, 'POST', `/imprest-vouchers/${v2.json.data.id}/submit`)).json.data.status, 'SUBMITTED');
  // BR-01: never more than the cash in hand not yet spoken for (₹37,500 − ₹12,000 pending)
  const big = await voucher(30000); assert.equal(big.status, 400); assert.match(JSON.stringify(big.json), /BR-01/);
  assert.equal((await w.act(U.cm, w.wf('fin_imprest_vouchers', v2.json.data.id))).status, 200);
  let iv = (await w.call(U.sacc, 'GET', `/imprests/${iid}`)).json.data; assert.equal(iv.balance, 25500); assert.equal(iv.toReplenish, 14500);
  // the replenishment of the approved vouchers: the project manager, then the accounts manager; paid from the bank
  const v3 = await voucher(400, { category: 'FOOD', description: 'Tea for the pour crew' }); assert.equal(v3.status, 201); // a draft: not replenished
  const rp = await w.call(U.sacc, 'POST', '/imprest-replenishments', { imprestId: iid, bankAccountId: w.bankId }); assert.equal(rp.status, 201, JSON.stringify(rp.json));
  assert.equal(rp.json.data.amount, 14500); assert.equal(rp.json.data.vouchers, 2);
  assert.equal((await w.call(U.sacc, 'POST', '/imprest-replenishments', { imprestId: iid, bankAccountId: w.bankId })).status, 422, 'BR-01: nothing approved is left to replenish');
  const rw = w.wf('fin_imprest_replenishments', rp.json.data.id); assert.equal((await w.act(U.pm, rw)).status, 200); assert.equal((await w.act(U.acc, rw)).status, 200);
  iv = (await w.call(U.sacc, 'GET', `/imprests/${iid}`)).json.data; assert.equal(iv.balance, 40000); assert.equal(iv.toReplenish, 0);
  // a cash count: ₹39,900 against ₹40,000
  const cc = await w.call(U.sacc, 'POST', `/imprests/${iid}/count`, { denominations: { 500: 79, 200: 2, 100: 0, 10: 0 } }); assert.equal(cc.status, 200, JSON.stringify(cc.json)); assert.equal(cc.json.data.counts[0].difference, -100);
  // the daily position: the bank (the contra and the replenishment out) and the cash
  const pos = (await w.call(U.cfo, 'GET', `/cash-position?date=${today}`)).json.data; const b = pos.banks.find((x) => x.id === w.bankId);
  assert.equal(b.book, -54500, 'opening 0, ₹40,000 and ₹14,500 out'); assert.equal(pos.cash.find((x) => x.id === iid).balance, 40000); assert.equal(pos.totals.cash, 40000);
  // rights
  assert.equal((await w.call(U.se, 'GET', '/cash-position')).status, 403); assert.equal((await w.call(U.se, 'GET', '/imprests')).status, 403);
  assert.equal((await w.call(U.aud, 'GET', `/brs?bankAccountId=${w.bankId}`)).status, 200); assert.equal((await w.call(U.sacc, 'GET', `/bank-statements?bankAccountId=${w.bankId}`)).status, 403);
});
