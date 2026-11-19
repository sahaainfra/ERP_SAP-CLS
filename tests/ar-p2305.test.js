import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { todayIST } from '../src/shared/dates.js';

// Part 23.05: accounts receivable.
//  T-01 a receipt with deductions allocates correctly (oldest first: the amount received plus TDS, GST-TDS and retention settles the invoices; BR-01 what is set against
//  invoices is at most the receipt's amount plus its deductions, the rest on account) and the ageing buckets are right (by days past the due date).
//  and: receivables made by the tax invoice's event (once), linked back to the invoice; the receipt's journal (Dr bank, TDS, GST-TDS, retention; Cr trade receivables);
//  a manual allocation, a receipt on account allocated later, a receipt cancelled and reversed; other income approved and posted; a credit note above ₹5 lakh through
//  the accounts manager and the CFO with its GST and the IRN date; a write-off through the accounts manager, the CFO and a director; follow-ups with a promise, the
//  broken promise escalated; the dunning letter; DSO; the client statement; the TDS deducted by clients; the AP reconciliation of 23.02 reads the receivables; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), dir: as('DIR', 'dir1'), aud: as('AUD', 'aud1'), pm: as('PM', 'pm1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const today = todayIST();

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(JSON.stringify([{ gstin: '36AAACM1234F1Z5', stateCode: '36' }]));
  const client = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, 'C1', 'Telangana Housing Board', 'TSHB', 'GOVERNMENT', 'AAAGT1234F', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  fill(d, 'mdm_partner_roles', { company_id: 1, partner_id: client, partner_role: 'CLIENT' });
  fill(d, 'mdm_partner_gstins', { company_id: 1, partner_id: client, gstin: '36AAAGT1234F1Z1', state_code: '36', gstin_status: 'ACTIVE' });
  const contract = fill(d, 'ctr_contracts', { company_id: 1, org_project_id: r.A, client_partner_id: client, payment_terms_json: JSON.stringify({ certificationDays: 15, paymentDays: 30, delayInterestPct: 12 }), status: 'APPROVED' });
  const bank = await call(U.cfo, 'POST', '/bank-accounts', { code: 'SBI-CA', name: 'SBI collections', bankName: 'State Bank of India', ifsc: 'SBIN0000001', accountNo: '30200012345678', glAccountId: acct('150002'), fileFormat: 'GENERIC_CSV' });
  assert.equal(bank.status, 201, JSON.stringify(bank.json));
  let n = 0;
  /** A tax invoice issued (22.04): the row, then its event. */
  const issue = (date, taxable, due) => { n += 1; const gst = Math.round(taxable * 18) / 100; const ti = fill(d, 'bill_tax_invoices', { company_id: 1, org_project_id: r.A, contract_id: contract, bill_id: 900 + n, invoice_no: `36/2026-27/0000${n}`, invoice_date: date, taxable_paise: Math.round(taxable * 100), cgst_paise: Math.round(gst * 50), sgst_paise: Math.round(gst * 50), total_paise: Math.round((taxable + gst) * 100), supply: 'intra', gstin_from: '36AAACM1234F1Z5', gstin_to: '36AAAGT1234F1Z1', place_state: '36', due_date: due, status: 'APPROVED', ar_state: 'HANDED' });
    publishEvent(d, { type: 'bill.invoice.issued', entity: 'bill_tax_invoices', entityId: ti, actorId: 'test', companyId: 1, data: { invoiceId: ti, invoiceNo: `36/2026-27/0000${n}`, invoiceDate: date, projectId: r.A, contractId: contract, supply: 'intra', taxable, cgst: gst / 2, sgst: gst / 2, igst: 0, total: taxable + gst, dueDate: due } }); return ti; };
  const arOf = (ti) => d.prepare("SELECT * FROM ar_invoices WHERE inv_source = 'TAX_INVOICE' AND source_ref = ?").get(String(ti));
  return { ...r, call, acct, client, contract, bankId: bank.json.data.id, issue, arOf, drain: () => r.drain() };
}

test('T-01 a receipt with deductions allocates correctly (BR-01); the ageing buckets are right', async () => {
  const w = await world();
  const ta = w.issue('2026-06-01', 1000000, '2026-07-01'); const tb = w.issue('2026-06-20', 500000, '2026-07-20'); await w.drain();
  const a = w.arOf(ta); const b = w.arOf(tb); assert.equal(a.amount_paise, 118000000); assert.equal(a.interest_bp, 1200, 'the contract allows 12 % a year on delay');
  assert.equal(w.d.prepare('SELECT ar_state, ar_ref FROM bill_tax_invoices WHERE id = ?').get(ta).ar_ref, a.doc_no, 'linked back to the tax invoice');
  publishEvent(w.d, { type: 'bill.invoice.issued', entity: 'bill_tax_invoices', entityId: ta, actorId: 'test', companyId: 1, data: { invoiceId: ta, invoiceNo: 'x', invoiceDate: '2026-06-01', contractId: w.contract, total: 1 } }); await w.drain();
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM ar_invoices WHERE inv_source = 'TAX_INVOICE'").get().n, 2, 'once per tax invoice');
  // ₹15,00,000 received; the client deducted TDS ₹20,000, GST-TDS ₹20,000 and retention ₹50,000: ₹15,90,000 settles A (₹11,80,000) and ₹4,10,000 of B
  const body = { partnerId: w.client, receiptDate: today, bankAccountId: w.bankId, reference: 'UTR SBIN526001', amount: 1500000, tds: 20000, tdsSection: '393(1)', gstTds: 20000, retention: 50000, auto: true };
  assert.equal((await w.call(U.pm, 'POST', '/receipts', body)).status, 403);
  const c = await w.call(U.fin, 'POST', '/receipts', { ...body, post: true }); assert.equal(c.status, 201, JSON.stringify(c.json));
  const rc = c.json.data; assert.equal(rc.status, 'APPROVED'); assert.equal(rc.gross, 1590000); assert.equal(rc.allocated, 1590000); assert.equal(rc.unallocated, 0);
  assert.deepEqual(rc.allocations.map((x) => [x.docNo, x.amount]), [[a.doc_no, 1180000], [b.doc_no, 410000]], 'oldest first');
  assert.equal((await w.call(U.fin, 'GET', `/invoices/${b.id}`)).json.data.balance, 180000);
  const jl = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ?').all(rc.journalId); const at = (code) => jl.find((l) => l.account_id === w.acct(code));
  assert.equal(at('150002').debit_paise, 150000000); assert.equal(at('170004').debit_paise, 2000000); assert.equal(at('170005').debit_paise, 2000000); assert.equal(at('140002').debit_paise, 5000000); assert.equal(at('140001').credit_paise, 159000000);
  assert.equal(w.events('fin.receipt.posted').length, 1);
  // BR-01 by hand: more than the receipt brings, more than an invoice has open, are refused; the rest stays on account
  const over = await w.call(U.fin, 'POST', '/receipts', { ...body, amount: 100000, tds: 0, gstTds: 0, retention: 0, auto: false, allocations: [{ invoiceId: b.id, amount: 150000 }], post: true }); assert.equal(over.status, 400); assert.match(JSON.stringify(over.json), /more than the receipt brings/);
  const tooMuch = await w.call(U.fin, 'POST', '/receipts', { ...body, amount: 300000, tds: 0, gstTds: 0, retention: 0, auto: false, allocations: [{ invoiceId: b.id, amount: 200000 }], post: true }); assert.equal(tooMuch.status, 400); assert.match(JSON.stringify(tooMuch.json), /open/);
  const part = await w.call(U.fin, 'POST', '/receipts', { ...body, reference: 'UTR SBIN526002', amount: 200000, tds: 0, gstTds: 0, retention: 0, auto: false, allocations: [{ invoiceId: b.id, amount: 100000 }], post: true }); assert.equal(part.status, 201, JSON.stringify(part.json));
  assert.equal(part.json.data.unallocated, 100000, 'the rest on account');
  const later = await w.call(U.fin, 'POST', `/receipts/${part.json.data.id}/allocate`, { auto: true }); assert.equal(later.status, 200, JSON.stringify(later.json));
  assert.equal(later.json.data.unallocated, 20000, 'B had ₹80,000 left; ₹20,000 stays on account'); assert.equal((await w.call(U.fin, 'GET', `/invoices/${b.id}`)).json.data.balance, 0);
  // a receipt cancelled: reversed, its allocations undone
  const cx = await w.call(U.acc, 'POST', `/receipts/${part.json.data.id}/cancel`, { reason: 'Entered against the wrong client' }); assert.equal(cx.status, 200);
  assert.equal((await w.call(U.fin, 'GET', `/invoices/${b.id}`)).json.data.balance, 180000); assert.ok(w.d.prepare('SELECT 1 FROM fin_journals WHERE reversal_of_id = ?').get(part.json.data.journalId));
  // the ageing on 15-08-2026 of two more invoices: one due 01-05-2026 (106 days: over 90), one due 20-07-2026 (26 days: 1–30); B (₹1,80,000) is 26 days past its due date
  const tc = w.issue('2026-04-01', 100000, '2026-05-01'); const td = w.issue('2026-07-10', 200000, '2026-07-20'); const te = w.issue('2026-08-10', 50000, '2026-09-09'); await w.drain();
  const age = (await w.call(U.aud, 'GET', '/receivables/ageing?asOf=2026-08-15')).json.data; const row = age.rows[0];
  assert.equal(row.b91, 118000); assert.equal(row.b1, 236000 + 180000); assert.equal(row.current, 59000); assert.equal(row.b31, 0); assert.equal(row.b61, 0); assert.equal(row.total, 118000 + 236000 + 180000 + 59000);
  assert.ok(age.dso > 0); void te; void tc; void td;
  // the TDS deducted by clients, by quarter; marked as found in 26AS by the accounts manager
  const tds = (await w.call(U.aud, 'GET', '/receivables/tds')).json.data; assert.equal(tds.tds, 20000); assert.equal(tds.gstTds, 20000); assert.equal(tds.unmatched, 20000);
  assert.equal((await w.call(U.fin, 'POST', `/receipts/${rc.id}/tds-matched`, { matched: true })).status, 403); assert.equal((await w.call(U.acc, 'POST', `/receipts/${rc.id}/tds-matched`, { matched: true })).status, 200);
  assert.equal((await w.call(U.aud, 'GET', '/receivables/tds')).json.data.unmatched, 0);
  // the client statement; the 23.02 reconciliation reads the receivables and agrees with the ledger
  const st = (await w.call(U.aud, 'GET', `/receivables/statement?partnerId=${w.client}`)).json.data; assert.equal(st.closing, 118000 + 236000 + 180000 + 59000);
  assert.ok(st.rows.some((x) => x.kind === 'DEDUCTION'));
});

test('FR-01 other income; FR-04 a credit note through the accounts manager and the CFO; a write-off through three; FR-05 follow-ups and escalation; rights', async () => {
  const w = await world();
  // other income: the hire of an excavator to another contractor, approved by the accounts manager and posted
  const inc = (await w.call(U.fin, 'GET', '/journals/options')).json.data.accounts.find((x) => x.code === '420001');
  const o = await w.call(U.fin, 'POST', '/invoices', { partnerId: w.client, projectId: w.A, incomeKind: 'HIRE_OUT', incomeAccountId: inc.id, description: 'Excavator hired out for 10 days', invoiceDate: '2026-08-01', amount: 100000, gst: 18000 }); assert.equal(o.status, 201, JSON.stringify(o.json));
  const oid = o.json.data.id; assert.equal((await w.call(U.fin, 'POST', `/invoices/${oid}/submit`)).status, 202);
  { const ap1 = await w.act(U.acc, w.wf('ar_invoices', oid)); assert.equal(ap1.status, 200, JSON.stringify(ap1.json)); }
  const ov = (await w.call(U.fin, 'GET', `/invoices/${oid}`)).json.data; assert.equal(ov.status, 'APPROVED'); assert.ok(ov.journalId);
  const ol = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ?').all(ov.journalId); assert.equal(ol.find((l) => l.account_id === w.acct('140001')).debit_paise, 11800000); assert.equal(ol.find((l) => l.account_id === w.acct('230001')).credit_paise, 900000);
  // D-736: scrap sold to a dealer: TCS 1 % of ₹59,000 (5 % without the buyer's PAN) added to the receivable and owed to the government; the 27EQ statement of the quarter
  const pan = w.d.prepare('SELECT pan FROM mdm_partners WHERE id = ?').get(w.client).pan; const tcs = pan ? 590 : 2950;
  const sc = await w.call(U.fin, 'POST', '/invoices', { partnerId: w.client, projectId: w.A, incomeKind: 'SCRAP', incomeAccountId: inc.id, description: 'MS scrap 2.4 t', invoiceDate: '2026-08-05', amount: 50000, gst: 9000 }); assert.equal(sc.status, 201, JSON.stringify(sc.json)); assert.equal(sc.json.data.tcs, tcs); assert.equal(sc.json.data.amount ?? sc.json.data.total, 59000 + tcs);
  assert.equal((await w.call(U.fin, 'POST', `/invoices/${sc.json.data.id}/submit`)).status, 202); assert.equal((await w.act(U.acc, w.wf('ar_invoices', sc.json.data.id))).status, 200);
  const sj = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ?').all((await w.call(U.fin, 'GET', `/invoices/${sc.json.data.id}`)).json.data.journalId); assert.equal(sj.find((l) => l.account_id === w.acct('230007')).credit_paise, tcs * 100); assert.equal(sj.find((l) => l.account_id === w.acct('140001')).debit_paise, (59000 + tcs) * 100);
  const tq = (await w.call(U.acc, 'GET', '/tcs-returns?quarter=2026-27-Q2')).json.data; assert.equal(tq.form, '27EQ'); assert.equal(tq.certificate, '27D'); assert.equal(tq.deducted, tcs); assert.equal(tq.rows[0].section, '6CE'); assert.equal(tq.rows[0].paid, 59000);
  assert.equal((await w.call(U.acc, 'GET', '/tds-returns?quarter=2026-27-Q2')).json.data.tcs.collected, tcs, 'the TDS page tells the TCS of the quarter');
  const jv = fill(w.d, 'fin_journals', { company_id: 1, doc_no: 'JV/TCS/1', voucher_no: 'BP/TCS1', voucher_date: '2026-09-06', narration: 'TCS of August paid', status: 'APPROVED' });
  fill(w.d, 'fin_journal_lines', { company_id: 1, journal_id: jv, line_no: 1, account_id: w.acct('230007'), debit_paise: tcs * 100, credit_paise: 0 }); fill(w.d, 'fin_journal_lines', { company_id: 1, journal_id: jv, line_no: 2, account_id: w.acct('420001'), debit_paise: 0, credit_paise: tcs * 100 });
  assert.equal((await w.call(U.acc, 'GET', '/tcs-returns/deposits?quarter=2026-27-Q2')).json.data.rows.length, 1); assert.equal((await w.call(U.acc, 'GET', '/tds-returns/deposits?quarter=2026-27-Q2')).json.data.rows.length, 0, 'a TCS deposit is not a TDS one');
  const tp = await w.call(U.acc, 'POST', '/tcs-returns/prepare', { quarter: '2026-27-Q2', tan: 'HYDM12345A', challans: [{ bsr: '0510308', date: '2026-09-06', serial: '00077', amount: String(tcs), journalId: jv }] }); assert.equal(tp.status, 200, JSON.stringify(tp.json)); assert.equal(tp.json.data.status, 'PREPARED');
  const tt = await w.api.raw('GET', '/api/v1/fin/tcs-returns/text?quarter=2026-27-Q2', { ...U.acc }); assert.equal(tt.status, 200); const rr = tt.buffer.toString('utf8').trim().split('\r\n').map((l) => l.split('^')); assert.deepEqual(rr.map((x) => x[1]), ['FH', 'BH', 'CD', 'DD']); assert.equal(rr[1][4], '27EQ');
  // a credit note of ₹6 lakh + GST on a tax invoice: above ₹5 lakh, the accounts manager then the CFO; GST at the invoice's rate, intra-state; the IRN date (e-invoicing on)
  const ti = w.issue('2026-07-01', 1000000, '2026-07-31'); await w.drain(); const inv = w.arOf(ti);
  const cn = await w.call(U.fin, 'POST', '/credit-notes', { invoiceId: inv.id, reason: 'RATE_REVISION', noteDate: today, description: 'Rate of item 4.2 revised by the client', taxable: 600000 }); assert.equal(cn.status, 201, JSON.stringify(cn.json));
  const cv = cn.json.data; assert.equal(cv.cgst, 54000); assert.equal(cv.sgst, 54000); assert.equal(cv.total, 708000); assert.equal(cv.irnRequired, true); assert.ok(cv.irnDueDate > today);
  assert.equal((await w.call(U.fin, 'POST', `/credit-notes/${cv.id}/submit`)).status, 202); const cw = w.wf('ar_credit_notes', cv.id);
  assert.equal((await w.act(U.acc, cw)).status, 200); assert.equal((await w.call(U.fin, 'GET', `/credit-notes/${cv.id}`)).json.data.status, 'SUBMITTED');
  assert.equal((await w.act(U.cfo, cw)).status, 200); assert.equal((await w.call(U.fin, 'GET', `/credit-notes/${cv.id}`)).json.data.status, 'APPROVED');
  assert.equal((await w.call(U.fin, 'GET', `/invoices/${inv.id}`)).json.data.balance, 1180000 - 708000);
  const tooBig = await w.call(U.fin, 'POST', '/credit-notes', { invoiceId: inv.id, reason: 'DISPUTE', noteDate: today, description: 'More than is open', taxable: 500000 }); assert.equal(tooBig.status, 400);
  // a write-off of what is left: the accounts manager, the CFO, a director
  const wo = await w.call(U.fin, 'POST', '/write-offs', { invoiceId: inv.id, amount: 472000, reason: 'The client has gone into liquidation; nothing will be recovered' }); assert.equal(wo.status, 201, JSON.stringify(wo.json));
  assert.equal((await w.call(U.fin, 'POST', `/write-offs/${wo.json.data.id}/submit`)).status, 202); const ww = w.wf('ar_writeoffs', wo.json.data.id);
  for (const who of [U.acc, U.cfo, U.dir]) assert.equal((await w.act(who, ww)).status, 200);
  assert.equal((await w.call(U.fin, 'GET', `/write-offs/${wo.json.data.id}`)).json.data.status, 'APPROVED'); assert.equal((await w.call(U.fin, 'GET', `/invoices/${inv.id}`)).json.data.balance, 0);
  // collections: an overdue tax invoice; the project manager logs a call with a promise; the promise not kept escalates once
  const late = w.issue('2026-05-01', 200000, '2026-06-01'); await w.drain(); const li = w.arOf(late);
  const wl = (await w.call(U.pm, 'GET', '/receivables/collections')).json.data; const card = wl.rows.find((x) => x.id === li.id); assert.ok(card); assert.equal(card.sla, 'RED'); assert.ok(card.interest > 0, 'interest on the delay at the contract rate');
  const fu = await w.call(U.pm, 'POST', `/invoices/${li.id}/followups`, { date: '2026-10-01', action: 'CALL', notes: 'Spoke to the EE; bill is with accounts', contact: 'Executive Engineer', promisedDate: '2026-10-15', promised: 236000 }); assert.equal(fu.status, 201, JSON.stringify(fu.json));
  assert.equal(fu.json.data.promisedDate, '2026-10-15'); assert.equal(fu.json.data.followups.length, 1);
  assert.equal((await w.call(U.se, 'POST', `/invoices/${li.id}/followups`, { date: '2026-10-01', action: 'CALL', notes: 'x x x' })).status, 403);
  const { arOf } = await import('../src/server/modules/fin/index.js');
  assert.equal(arOf(w.d).followups.escalate(1, '2026-10-20'), 1); assert.equal(arOf(w.d).followups.escalate(1, '2026-10-21'), 0, 'once');
  assert.ok((await w.call(U.acc, 'GET', `/invoices/${li.id}`)).json.data.followups.some((f) => f.action === 'ESCALATION'));
  const dun = await w.call(U.fin, 'GET', `/invoices/${li.id}/dunning`); assert.equal(dun.status, 200);
  // rights: the site engineer sees nothing; the auditor reads; the director cannot enter receipts
  assert.equal((await w.call(U.se, 'GET', '/invoices')).status, 403); assert.equal((await w.call(U.aud, 'GET', '/invoices')).status, 200);
  assert.equal((await w.call(U.dir, 'POST', '/receipts', { partnerId: w.client, receiptDate: today, bankAccountId: w.bankId, amount: 1000 })).status, 403);
  assert.equal((await w.call(U.aud, 'GET', '/invoices/export')).status, 200);
});
