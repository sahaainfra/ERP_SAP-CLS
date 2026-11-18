import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { createVault } from '../src/server/platform/integrations/vault.js';
import { todayIST } from '../src/shared/dates.js';
import { FORMATS, buildBankFile, nameMatch, validateBankFile } from '../src/server/modules/fin/payments.js';

// Part 23.04: payments.
//  T-01 a duplicate payment is blocked (the same bill in a second proposal, more than is left to pay, a second release, a UTR used twice); the bank file is
//  validated (read back against the run: count, total, fields, IFSC, account number; a broken file is refused); segregation of duties: the preparer does not
//  approve, neither the preparer nor an approver releases.
//  and: BR-01 (cooling-off and name mismatch keep a line out); the approval by band (accounts manager; CFO above ₹10 lakh); the release posts Dr payable / Cr bank and
//  accounts payable settles the bill from fin.payment.released; the bank's confirmation file (UTR) and the advice; a payment returned by the bank reversed and the bill
//  open again; an advance paid by cheque from the series, the cheque register, a cheque cancelled; the vendor ledger; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), acc2: as('ACCMGR', 'acc2'), cfo: as('CFO', 'cfo1'), dir: as('DIR', 'dir1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const today = todayIST();

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(JSON.stringify([{ gstin: '36AAACM1234F1Z5', stateCode: '36' }]));
  const vault = createVault(); let n = 0;
  const partner = (name, o = {}) => {
    n += 1; const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', 'AABCD1234E', 'ACTIVE', 'PROCMGR', 'test')").run(`P${n}`, name, name).lastInsertRowid);
    fill(d, 'mdm_partner_gstins', { company_id: 1, partner_id: id, gstin: `36AABCD${String(1000 + n)}E1Z${n % 10}`, state_code: '36', gstin_status: 'ACTIVE' });
    fill(d, 'mdm_partner_roles', { company_id: 1, partner_id: id, partner_role: o.role ?? 'VENDOR' });
    fill(d, 'mdm_partner_contacts', { company_id: 1, partner_id: id, name: 'Accounts', email: `accounts${n}@example.com`, is_primary: 1 });
    const acc = `5010${String(n).padStart(8, '0')}`;
    fill(d, 'mdm_partner_banks', { company_id: 1, partner_id: id, account_no_encrypted: vault.encrypt(acc, `mdm_partner_bank/1/${id}`), account_hash: `h${n}`, account_last4: acc.slice(-4), ifsc: 'HDFC0001234', account_name: o.accountName ?? name, bank_status: 'ACTIVE', is_primary: 1, cooling_off_until: o.cooling ?? null });
    return { id, acc };
  };
  const inv = (vendorId, date, taxable) => { n += 1; const id = 7000 + n; publishEvent(d, { type: 'ap.invoice.matched', entity: 'bill_vendor_invoices', entityId: id, actorId: 'test', companyId: 1, data: { invoiceId: id, invoiceNo: `INV-${n}`, invoiceDate: date, fy: '2026-27', kind: 'PO', projectId: r.A, vendorId, vendorGstin: '36AABCD1234E1Z2', taxable, tax: Math.round(taxable * 18) / 100, total: taxable + Math.round(taxable * 18) / 100, debit: 0, payable: taxable + Math.round(taxable * 18) / 100, dueDate: date, matchStatus: 'MATCHED', itc: [] } }); return id; };
  const billOf = (ref) => d.prepare("SELECT * FROM ap_bills WHERE bill_source = 'VENDOR_INVOICE' AND source_ref = ?").get(String(ref));
  // the company's bank account, set up by the CFO
  const bank = await call(U.cfo, 'POST', '/bank-accounts', { code: 'HDFC-CA', name: 'HDFC current account', bankName: 'HDFC Bank', ifsc: 'HDFC0000001', accountNo: '50200012345678', glAccountId: acct('150002'), fileFormat: 'GENERIC_CSV', chequeFrom: 100001, chequeTo: 100050 });
  assert.equal(bank.status, 201, JSON.stringify(bank.json));
  return { ...r, call, acct, partner, inv, billOf, bankId: bank.json.data.id, drain: () => r.drain() };
}
const line = (b, amount) => ({ kind: 'BILL', billId: b.id, amount: amount ?? b.net_payable_paise / 100 });

test('T-01 duplicate payments blocked; the bank file validated; SoD: preparer ≠ approver ≠ releaser; settlement, confirmation and advice', async () => {
  const w = await world();
  const a = w.partner('Deccan Cement Traders Pvt Ltd'); const cool = w.partner('Krishna Steel Pvt Ltd', { cooling: '2099-01-01' }); const odd = w.partner('Nizam Hardware Pvt Ltd', { accountName: 'Ramesh Kumar' });
  const ia = w.inv(a.id, '2026-06-10', 20000); const ic = w.inv(cool.id, '2026-06-12', 10000); const io = w.inv(odd.id, '2026-06-14', 5000); await w.drain();
  const ba = w.billOf(ia); const bc = w.billOf(ic); const bo = w.billOf(io); assert.ok(ba && bc && bo);
  // the bank account: the number kept encrypted and shown masked
  const banks = (await w.call(U.fin, 'GET', '/bank-accounts')).json.data; assert.equal(banks[0].account, '••••••5678'); assert.ok(!JSON.stringify(banks).includes('50200012345678'));
  assert.ok(!w.d.prepare('SELECT account_no_enc FROM fin_bank_accounts').get().account_no_enc.includes('50200012345678'));
  assert.equal((await w.call(U.fin, 'POST', '/bank-accounts', { code: 'X', name: 'Xxx', bankName: 'X', ifsc: 'HDFC0000001', accountNo: '123456789', glAccountId: w.acct('150002'), fileFormat: 'GENERIC_CSV' })).status, 403, 'only the CFO keeps the bank accounts');
  // FR-01: what may be paid; the cooling-off shown
  const cr = await w.call(U.fin, 'GET', '/proposals/candidates'); assert.equal(cr.status, 200, JSON.stringify(cr.json)); const cand = cr.json.data;
  assert.ok(cand.bills.find((x) => x.billId === ba.id)); assert.ok(!cand.bills.some((x) => x.billId === bc.id), 'BR-01: a vendor whose bank changed is out while it cools off');
  assert.match(cand.bills.find((x) => x.billId === bo.id).bankProblem, /does not match/);
  const body = (lines, mode = 'NEFT') => ({ bankAccountId: w.bankId, payMode: mode, payDate: today, purpose: 'Weekly vendor run', lines });
  assert.equal((await w.call(U.aud, 'POST', '/proposals', body([line(ba)]))).status, 403);
  // BR-01: the bank in its cooling-off, the name mismatch, more than outstanding
  const bad1 = await w.call(U.fin, 'POST', '/proposals', body([line(bc)])); assert.equal(bad1.status, 400); assert.match(JSON.stringify(bad1.json), /payments wait until/);
  const bad2 = await w.call(U.fin, 'POST', '/proposals', body([line(bo)])); assert.equal(bad2.status, 400); assert.match(JSON.stringify(bad2.json), /does not match the payee/);
  const bad3 = await w.call(U.fin, 'POST', '/proposals', body([line(ba, ba.net_payable_paise / 100 + 1)])); assert.equal(bad3.status, 400); assert.match(JSON.stringify(bad3.json), /left to pay/);
  const bad4 = await w.call(U.fin, 'POST', '/proposals', body([line(ba, 1000), line(ba, 1000)])); assert.equal(bad4.status, 400); assert.match(JSON.stringify(bad4.json), /already a line/);
  const c = await w.call(U.fin, 'POST', '/proposals', body([line(ba)])); assert.equal(c.status, 201, JSON.stringify(c.json));
  const pid = c.json.data.id; assert.equal(c.json.data.lines[0].nameMatch, 'OK'); assert.equal(c.json.data.band, 'ACCMGR');
  // T-01 duplicate: the same bill in a second open proposal
  const dup = await w.call(U.fin, 'POST', '/proposals', body([line(ba, 100)])); assert.equal(dup.status, 400); assert.match(JSON.stringify(dup.json), /already in proposal PP\//);
  assert.equal((await w.call(U.fin, 'POST', `/proposals/${pid}/submit`)).status, 202);
  // T-01 SoD: the preparer has no approval task and cannot approve; the accounts manager approves (≤ ₹10 lakh: alone)
  const wf = w.wf('pmt_proposals', pid);
  assert.ok(!(await w.tasksOf(U.fin)).some((x) => x.instance.id === wf), 'no task for the preparer');
  assert.equal((await w.act(U.acc, wf)).status, 200);
  let v = (await w.call(U.fin, 'GET', `/proposals/${pid}`)).json.data; assert.equal(v.status, 'APPROVED'); assert.equal(v.can.release, false);
  // neither the preparer (no right) nor the approver may release; the CFO, a third person, does
  assert.equal((await w.call(U.fin, 'POST', `/proposals/${pid}/release`)).status, 403);
  const byApprover = await w.call(U.acc, 'POST', `/proposals/${pid}/release`); assert.equal(byApprover.status, 403); assert.match(byApprover.json.error.message, /You approved this proposal/);
  assert.equal((await w.call(U.acc, 'GET', `/proposals/${pid}`)).json.data.can.releaseBlocked, 'You approved this proposal: another person releases it.');
  const rel = await w.call(U.cfo, 'POST', `/proposals/${pid}/release`); assert.equal(rel.status, 200, JSON.stringify(rel.json));
  v = rel.json.data; assert.equal(v.runStatus, 'RELEASED'); assert.equal(v.payments.length, 1); assert.equal(v.payments[0].status, 'PENDING'); assert.match(v.fileName, /\.csv$/);
  // posted: Dr trade payables (the partner), Cr the bank's ledger account
  const pay = w.d.prepare('SELECT * FROM pmt_payments WHERE proposal_id = ?').get(pid); const jl = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ?').all(pay.journal_id);
  assert.equal(jl.find((l) => l.account_id === w.acct('220001')).debit_paise, ba.net_payable_paise); assert.equal(jl.find((l) => l.account_id === w.acct('150002')).credit_paise, ba.net_payable_paise);
  assert.equal(w.events('fin.payment.released').length, 1);
  // T-01 a second release is refused; accounts payable settles the bill from the event
  assert.equal((await w.call(U.cfo, 'POST', `/proposals/${pid}/release`)).status, 409);
  await w.drain(); assert.equal(w.billOf(ia).paid_paise, ba.net_payable_paise);
  assert.ok(!(await w.call(U.fin, 'GET', '/proposals/candidates')).json.data.bills.some((x) => x.billId === ba.id), 'nothing left to pay');
  const again = await w.call(U.fin, 'POST', '/proposals', body([line(ba, 100)])); assert.equal(again.status, 400, 'paid: no second payment');
  // T-01 the bank file: the full account number of the payee (audited), the run's count and total; read back and checked
  const file = await fetch(`${w.api.base}${F}/proposals/${pid}/bank-file`, { headers: { 'x-erp-user': U.cfo.user, 'x-erp-roles': U.cfo.roles, 'x-erp-company': '1' } }); assert.equal(file.status, 200);
  const text = await file.text(); const rows = text.trim().split('\r\n');
  assert.equal(rows[0], FORMATS.GENERIC_CSV.columns.join(',')); assert.equal(rows.length, 2); assert.ok(rows[1].includes(a.acc)); assert.ok(rows[1].includes((ba.net_payable_paise / 100).toFixed(2)));
  assert.ok(w.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'mdm_partner_banks' AND action = 'view_bank'").get(), 'the account number shown is audited');
  assert.equal((await w.call(U.fin, 'GET', `/proposals/${pid}/bank-file`)).status, 403);
  // the bank's response file: UTR; the advice
  const csv = `Payment,UTR,Date,Status\n${pay.doc_no},HDFCN52026111800001,${today},SUCCESS`;
  assert.equal((await w.call(U.aud, 'POST', '/payments/confirm', { csv })).status, 403);
  const conf = await w.call(U.fin, 'POST', '/payments/confirm', { csv }); assert.equal(conf.status, 200, JSON.stringify(conf.json)); assert.equal(conf.json.data.paid, 1);
  const pv = (await w.call(U.fin, 'GET', `/payments/${pay.id}`)).json.data; assert.equal(pv.status, 'PAID'); assert.equal(pv.utr, 'HDFCN52026111800001'); assert.ok(pv.adviceStatus); assert.equal(pv.bill.tds, ba.tds_paise / 100);
  assert.ok(w.d.prepare("SELECT 1 FROM comm_messages WHERE related_entity = 'pmt_payments' AND related_id = ?").get(String(pay.id)), 'the advice went to the gateway (sent or blocked with its reason)');
  assert.equal((await w.call(U.fin, 'GET', `/proposals/${pid}`)).json.data.runStatus, 'CONFIRMED');
  // the same UTR again is a duplicate
  const conf2 = await w.call(U.fin, 'POST', '/payments/confirm', { rows: [{ docNo: pay.doc_no, status: 'PAID', utr: 'HDFCN52026111800001', paidOn: today }] }); assert.equal(conf2.json.data.results[0].message, 'Already recorded.');
  // the vendor ledger shows the payment
  const led = (await w.call(U.acc, 'GET', `/payables/vendor-ledger?partnerId=${a.id}`)).json.data; assert.ok(led.rows.some((x) => x.kind === 'PAYMENT' && x.theirRef === 'UTR HDFCN52026111800001')); assert.equal(led.closing, 0);
  // the AP bill lists it
  assert.equal((await w.call(U.acc, 'GET', `/bills/${ba.id}`)).json.data.payments[0].status, 'PAID');
});

test('T-01 the bank file check: a file that does not match its run is refused; the name match', () => {
  const t = FORMATS.H2H_PIPE; const recs = [{ mode: 'NEFT', debitAccount: '50200012345678', amountPaise: 123456, valueDate: '2026-11-18', accountNo: '501000000001', ifsc: 'HDFC0001234', beneficiaryName: 'Deccan | Cement', reference: 'PAY000001', purpose: 'Bill' }];
  const text = buildBankFile(t, recs); assert.match(text, /^NEFT\|50200012345678\|1234\.56\|18\/11\/2026\|501000000001\|HDFC0001234\|Deccan Cement\|PAY000001\|Bill\r\nT\|1\|1234\.56\r\n$/);
  assert.deepEqual(validateBankFile(t, text, { count: 1, totalPaise: 123456 }), []);
  assert.ok(validateBankFile(t, text, { count: 1, totalPaise: 123400 }).some((p) => /totals/.test(p)));
  assert.ok(validateBankFile(t, text.replace('HDFC0001234', 'HDFC001234'), { count: 1, totalPaise: 123456 }).some((p) => /not an IFSC/.test(p)));
  assert.ok(validateBankFile(t, text.replace('501000000001', '50100'), { count: 1, totalPaise: 123456 }).some((p) => /9 to 18 digits/.test(p)));
  assert.ok(validateBankFile(t, text.replace('|Bill', '|Bill|extra'), { count: 1, totalPaise: 123456 }).some((p) => /fields/.test(p)));
  assert.equal(nameMatch('Deccan Cement Traders Pvt Ltd', 'DECCAN CEMENT TRADERS PRIVATE LIMITED').ok, true);
  assert.equal(nameMatch('M/s. Sri Sai Fabricators', 'Sri Sai Fabricators').ok, true);
  assert.equal(nameMatch('Nizam Hardware Pvt Ltd', 'Ramesh Kumar').ok, false);
});

test('§9 approval by band (CFO above ₹10 lakh); a payment returned by the bank reversed; an advance by cheque from the series, the register, a cheque cancelled; rights', async () => {
  const w = await world();
  const s = w.partner('Godavari Earthmovers Pvt Ltd', { role: 'SUBCONTRACTOR' });
  // ₹12 lakh on account by RTGS: the accounts manager, then the CFO
  const body = { bankAccountId: w.bankId, payMode: 'RTGS', payDate: today, lines: [{ kind: 'ON_ACCOUNT', partnerId: s.id, projectId: w.A, amount: 1200000, purpose: 'Mobilisation of the second excavator' }] };
  const noProj = await w.call(U.fin, 'POST', '/proposals', { ...body, lines: [{ ...body.lines[0], projectId: undefined }] }); assert.equal(noProj.status, 400); assert.match(JSON.stringify(noProj.json), /needs a project/);
  const small = await w.call(U.fin, 'POST', '/proposals', { ...body, lines: [{ ...body.lines[0], amount: 150000 }] }); assert.equal(small.status, 400); assert.match(JSON.stringify(small.json), /RTGS carries/);
  const c = await w.call(U.fin, 'POST', '/proposals', body); assert.equal(c.status, 201, JSON.stringify(c.json)); const pid = c.json.data.id; assert.equal(c.json.data.band, 'CFO');
  assert.equal((await w.call(U.fin, 'POST', `/proposals/${pid}/submit`)).status, 202);
  const wf = w.wf('pmt_proposals', pid);
  assert.equal((await w.act(U.acc, wf)).status, 200); assert.equal((await w.call(U.fin, 'GET', `/proposals/${pid}`)).json.data.status, 'SUBMITTED', 'above ₹10 lakh the CFO approves too');
  assert.equal((await w.act(U.cfo, wf)).status, 200); assert.equal((await w.call(U.fin, 'GET', `/proposals/${pid}`)).json.data.status, 'APPROVED');
  // both approvers are kept from releasing; another accounts manager releases
  assert.equal((await w.call(U.cfo, 'POST', `/proposals/${pid}/release`)).status, 403);
  const rel = await w.call(U.acc2, 'POST', `/proposals/${pid}/release`); assert.equal(rel.status, 200, JSON.stringify(rel.json));
  const pay = w.d.prepare('SELECT * FROM pmt_payments WHERE proposal_id = ?').get(pid); const dr = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? AND debit_paise > 0').get(pay.journal_id);
  assert.equal(dr.account_id, w.acct('220002'), 'a subcontractor: its payables account');
  // the bank returns it: reversed, the line failed
  const bad = await w.call(U.fin, 'POST', '/payments/confirm', { rows: [{ paymentId: pay.id, status: 'FAILED' }] }); assert.equal(bad.json.data.failed, 1);
  const ret = await w.call(U.fin, 'POST', '/payments/confirm', { rows: [{ paymentId: pay.id, status: 'FAILED', reason: 'Account closed (R03)' }] }); assert.equal(ret.json.data.reversed, 1, JSON.stringify(ret.json));
  assert.ok(w.d.prepare("SELECT 1 FROM fin_journals WHERE reversal_of_id = ? AND status = 'APPROVED'").get(pay.journal_id)); assert.equal(w.events('fin.payment.failed').length, 1);
  assert.equal((await w.call(U.fin, 'GET', `/proposals/${pid}`)).json.data.runStatus, 'CONFIRMED');
  // an advance approved for the subcontractor, paid by cheque
  const adv = fill(w.d, 'bill_advances', { company_id: 1, doc_no: 'ADV/7', ref_no: 'MOB-7', org_project_id: w.A, direction: 'GIVEN', party_type: 'SUBCONTRACTOR', party_id: s.id, adv_type: 'MOBILISATION', amount_paise: 50000000, advance_date: '2026-06-01', recovered_paise: 0, adv_state: 'ACTIVE', status: 'APPROVED', requested_by: 'test' });
  const cq = await w.call(U.fin, 'POST', '/proposals', { bankAccountId: w.bankId, payMode: 'CHEQUE', payDate: today, lines: [{ kind: 'ADVANCE', advanceId: adv, amount: 300000 }] }); assert.equal(cq.status, 201, JSON.stringify(cq.json));
  const over = await w.call(U.fin, 'POST', '/proposals', { bankAccountId: w.bankId, payMode: 'CHEQUE', payDate: today, lines: [{ kind: 'ADVANCE', advanceId: adv, amount: 1000 }] }); assert.match(JSON.stringify(over.json), /already in proposal/);
  const cid = cq.json.data.id; assert.equal((await w.call(U.fin, 'POST', `/proposals/${cid}/submit`)).status, 202);
  // a return for correction and a resubmission
  assert.equal((await w.act(U.acc, w.wf('pmt_proposals', cid), 'return')).status, 200); let cv = (await w.call(U.fin, 'GET', `/proposals/${cid}`)).json.data; assert.equal(cv.status, 'RETURNED');
  assert.equal((await w.call(U.fin, 'PATCH', `/proposals/${cid}`, { bankAccountId: w.bankId, payMode: 'CHEQUE', payDate: today, purpose: 'Mobilisation advance, first part', lines: [{ kind: 'ADVANCE', advanceId: adv, amount: 250000 }], version: cv.version })).status, 200);
  assert.equal((await w.call(U.fin, 'POST', `/proposals/${cid}/submit`)).status, 202); assert.equal((await w.act(U.acc, w.wf('pmt_proposals', cid))).status, 200);
  const crel = await w.call(U.cfo, 'POST', `/proposals/${cid}/release`); assert.equal(crel.status, 200, JSON.stringify(crel.json));
  const cpay = w.d.prepare('SELECT * FROM pmt_payments WHERE proposal_id = ?').get(cid); assert.equal(cpay.cheque_no, '100001'); assert.equal(w.d.prepare('SELECT cheque_next_no FROM fin_bank_accounts WHERE id = ?').get(w.bankId).cheque_next_no, 100002);
  assert.equal(w.d.prepare('SELECT account_id FROM fin_journal_lines WHERE journal_id = ? AND debit_paise > 0').get(cpay.journal_id).account_id, w.acct('160001'), 'an advance: Dr advances');
  const pdf = await w.call(U.fin, 'GET', `/proposals/${cid}/cheques`); assert.equal(pdf.status, 200);
  let reg = (await w.call(U.aud, 'GET', `/payments/cheque-register?bankAccountId=${w.bankId}`)).json.data; assert.equal(reg.rows[0].chequeNo, '100001'); assert.equal(reg.rows[0].statusLabel, 'Issued'); assert.equal(reg.bank.left, 49);
  assert.equal((await w.call(U.fin, 'POST', '/payments/confirm', { rows: [{ paymentId: cpay.id, status: 'CANCELLED', reason: 'Cheque damaged while printing' }] })).json.data.reversed, 1);
  reg = (await w.call(U.aud, 'GET', `/payments/cheque-register?bankAccountId=${w.bankId}`)).json.data; assert.equal(reg.rows[0].statusLabel, 'Cancelled'); assert.equal(reg.cancelled, 1);
  // the advance can be proposed again for what is left
  assert.equal((await w.call(U.fin, 'GET', '/proposals/candidates')).json.data.advances.find((x) => x.advanceId === adv).left, 500000);
  // rights: a site engineer sees nothing; the auditor reads; the list and export
  assert.equal((await w.call(U.se, 'GET', '/payments')).status, 403); assert.equal((await w.call(U.se, 'GET', '/proposals')).status, 403);
  assert.equal((await w.call(U.aud, 'GET', '/payments')).json.data.length, 2); assert.equal((await w.call(U.aud, 'GET', '/payments/export')).status, 200);
  assert.equal((await w.call(U.dir, 'GET', '/proposals')).status, 200); assert.equal((await w.call(U.dir, 'POST', `/proposals/${cid}/release`)).status, 403);
});
