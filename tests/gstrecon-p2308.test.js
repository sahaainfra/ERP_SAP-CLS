import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { gstinCheckChar } from '../src/shared/gst.js';
import { normNo, parse2b } from '../src/server/modules/fin/gstrecon.js';

// Part 23.08: GST reconciliation, ITC review and TDS compliance.
//  T-01 the matching categories are right for seeded mismatches: matched (number written differently), amount, date and number differences, missing in the books,
//  missing in 2B; a rate charged across the 22-09-2025 change by the time of supply is matched, not a false mismatch.
//  and: owner, follow-up (its event for the vendor portal), resolution; the ITC review (eligible, held, blocked s.17(5), override with a reason only (BR-01), reversal for a
//  vendor unpaid beyond 180 days) made by the accounts manager and approved by the CFO, the reversal posted; GSTR-1 and GSTR-3B prepared and filed; the TDS statement
//  (Form 140 from April 2026, 26Q before) with its challans, filed, the certificate (131); 26AS matched to the TDS clients deducted; the compliance calendar; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const g = (first14) => `${first14}${gstinCheckChar(first14)}`;
const OWN = g('36AAACM1234F1Z'); const V1 = g('36AABCD1111A1Z'); const V2 = g('27AABCE2222B1Z'); const V3 = g('36AABCF3333C1Z'); const V4 = g('29AABCG4444D1Z');

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, pan, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', 'AAACM1234F', ?) ON CONFLICT(company_id) DO UPDATE SET legal_name = excluded.legal_name, pan = excluded.pan, gstins_json = excluded.gstins_json").run(JSON.stringify([{ gstin: OWN, stateCode: '36' }]));
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  const vendor = (code, name, gstin, pan) => { const p = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, ?, ?, 'PRIVATE_LIMITED', ?, 'ACTIVE', 'PROCMGR', 'test')").run(code, name, pan).lastInsertRowid); fill(d, 'mdm_partner_gstins', { company_id: 1, partner_id: p, gstin, state_code: gstin.slice(0, 2), gstin_status: 'ACTIVE' }); return p; };
  const v1 = vendor('V1', 'Deccan Cement Traders', V1, 'AABCD1111A'); const v2 = vendor('V2', 'Pune Steel Rolling', V2, 'AABCE2222B'); const v3 = vendor('V3', 'Sri Sai Hardware', V3, 'AABCF3333C');
  let n = 0;
  const bill = (partner, no, date, taxable, gst, o = {}) => { n += 1; return fill(d, 'ap_bills', { company_id: 1, doc_no: `AP/${String(n).padStart(6, '0')}`, bill_source: 'DIRECT', partner_id: partner, payee_name: `Vendor ${partner}`, bill_no: no, bill_date: date, due_date: date, expense_account_id: o.account ?? acct('510001'), gross_paise: taxable * 100, gst_input_paise: gst * 100, total_paise: (taxable + gst) * 100, net_payable_paise: (taxable + gst) * 100, paid_paise: o.paid ?? 0, tds_paise: (o.tds ?? 0) * 100, tds_section: o.tds ? '393(1)' : null, tds_base_paise: o.tds ? taxable * 100 : 0, tds_rate: o.tds ? 20000 : 0, status: 'APPROVED' }); };
  return { ...r, call, acct, v1, v2, v3, bill };
}
const csv = (rows) => ['GSTIN of supplier,Trade name,Type,Invoice number,Invoice date,Place of supply,Reverse charge,Rate (%),Taxable value,Integrated tax,Central tax,State/UT tax,Cess,ITC availability', ...rows.map((r) => r.join(','))].join('\n');

test('T-01 matching categories are right for seeded mismatches; the rate change by time of supply is matched; resolution and follow-ups', async () => {
  const w = await world(); const d = w.d;
  assert.equal(normNo('INV/0001'), normNo('inv-1')); assert.notEqual(normNo('B-78'), normNo('B-781'));
  const b1 = w.bill(w.v1, 'INV/001', '2026-10-05', 100000, 18000); const b2 = w.bill(w.v1, 'INV/002', '2026-10-08', 100000, 18000); const b3 = w.bill(w.v2, 'B-77', '2026-10-10', 200000, 36000);
  const b4 = w.bill(w.v2, 'B-78', '2026-10-15', 50000, 9000); const b5 = w.bill(w.v3, 'X-1', '2026-10-20', 10000, 1800);
  const file = csv([[V1, 'Deccan Cement Traders', 'Invoice', 'inv-0001', '05-10-2026', '36', 'N', '18', '100000', '0', '9000', '9000', '0', 'Yes'], [V1, 'Deccan Cement Traders', 'Invoice', 'INV/002', '08-10-2026', '36', 'N', '12', '100000', '0', '6000', '6000', '0', 'Yes'],
    [V2, 'Pune Steel Rolling', 'Invoice', 'B-77', '12-10-2026', '36', 'N', '18', '200000', '36000', '0', '0', '0', 'Yes'], [V2, 'Pune Steel Rolling', 'Invoice', 'B-78A', '15-10-2026', '36', 'N', '18', '50000', '9000', '0', '0', '0', 'Yes'], [V4, 'Bengaluru Tiles', 'Invoice', 'Z-9', '22-10-2026', '36', 'N', '18', '30000', '5400', '0', '0', '0', 'Yes']]);
  assert.equal((await w.call(U.fin, 'POST', '/gst-recon/import', { period: '2026-10', fileName: '2b.csv', format: 'CSV', content: file })).status, 403, 'the finance executive only reads');
  const imp = await w.call(U.acc, 'POST', '/gst-recon/import', { period: '2026-10', fileName: 'GSTR2B_102026.csv', format: 'CSV', content: file }); assert.equal(imp.status, 201, JSON.stringify(imp.json));
  assert.deepEqual(imp.json.data.counts, { MATCHED: 1, MISMATCH_AMOUNT: 1, MISMATCH_DATE: 1, MISMATCH_NUMBER: 1, MISSING_IN_BOOKS: 1 });
  const again = await w.call(U.acc, 'POST', '/gst-recon/import', { period: '2026-10', fileName: 'again.csv', format: 'CSV', content: file }); assert.equal(again.json.data.lines, 0); assert.equal(again.json.data.duplicates, 5);
  const wl = (await w.call(U.fin, 'GET', '/gst-recon?period=2026-10')).json.data;
  const by = (no) => wl.rows.find((r) => r.invoiceNo === no);
  assert.equal(by('inv-0001').status, 'MATCHED'); assert.equal(by('inv-0001').bill.id, b1); assert.equal(by('INV/002').status, 'MISMATCH_AMOUNT'); assert.equal(by('INV/002').bill.id, b2); assert.equal(by('INV/002').diff, -6000);
  assert.equal(by('B-77').status, 'MISMATCH_DATE'); assert.equal(by('B-77').bill.id, b3); assert.equal(by('B-78A').status, 'MISMATCH_NUMBER'); assert.equal(by('B-78A').bill.id, b4); assert.equal(by('Z-9').status, 'MISSING_IN_BOOKS');
  assert.equal(wl.counts.MISSING_IN_2B, 1); assert.equal(wl.missingIn2b[0].billId, b5);
  // the JSON of GSTN: the same document read the same way
  const j = parse2b(JSON.stringify({ data: { docdata: { b2b: [{ ctin: V1, trdnm: 'Deccan', inv: [{ inum: 'INV/001', dt: '05-10-2026', val: 118000, pos: '36', rev: 'N', itcavl: 'Y', items: [{ rt: 18, txval: 100000, igst: 0, cgst: 9000, sgst: 9000, cess: 0 }] }] }], cdnr: [{ ctin: V2, nt: [{ ntnum: 'CN-4', typ: 'C', dt: '20-10-2026', items: [{ rt: 18, txval: 1000, igst: 180 }] }] }] } } }), 'JSON');
  assert.equal(j.length, 2); assert.equal(j[0].cgst, 900000); assert.equal(j[1].type, 'CRN');
  // GST 2.0: cement invoiced 20-09-2025 at 28 % in the books; the supplier reported 18 % (supply after the change): matched with the note
  const b6 = w.bill(w.v1, 'CEM-1', '2025-09-20', 100000, 28000);
  const imp2 = await w.call(U.acc, 'POST', '/gst-recon/import', { period: '2025-09', fileName: '2b-sep.csv', format: 'CSV', content: csv([[V1, 'Deccan', 'Invoice', 'CEM-1', '20-09-2025', '36', 'N', '18', '100000', '0', '9000', '9000', '0', 'Yes']]) });
  assert.equal(imp2.json.data.counts.MATCHED, 1); const cem = (await w.call(U.acc, 'GET', '/gst-recon?period=2025-09')).json.data.rows[0]; assert.equal(cem.bill.id, b6); assert.match(cem.note, /Rate change of 2523/);
  // FR-02: the owner, a follow-up with the vendor (its event for the vendor portal), then accepted
  const l2 = by('INV/002');
  assert.equal((await w.call(U.acc, 'POST', `/gst-recon/lines/${l2.id}/act`, { action: 'assign', owner: 'acc1' })).status, 200);
  const fu = await w.call(U.acc, 'POST', `/gst-recon/lines/${l2.id}/act`, { action: 'followup', channel: 'EMAIL', note: 'Your GSTR-1 shows 12 %; our bill is 18 %. Please amend.', nextDate: '2026-11-25' }); assert.equal(fu.status, 200, JSON.stringify(fu.json)); assert.equal(fu.json.data.resolution, 'FOLLOW_UP'); assert.equal(fu.json.data.history.length, 1);
  assert.equal(w.events('fin.gst_recon.followup').at(-1).partnerId, w.v1);
  assert.equal((await w.call(U.acc, 'POST', `/gst-recon/lines/${l2.id}/act`, { action: 'followup', channel: 'EMAIL', note: 'x' })).status, 400);
  assert.equal((await w.call(U.acc, 'POST', `/gst-recon/lines/${by('B-77').id}/act`, { action: 'accept', note: 'Supplier dated the invoice on dispatch; accepted.' })).json.data.resolution, 'ACCEPTED');
  assert.equal((await w.call(U.acc, 'POST', `/gst-recon/lines/${b5}/act`, { on: 'bill', action: 'followup', channel: 'PORTAL', note: 'Not in your GSTR-1 for October: please report it.' })).status, 200);
  assert.equal((await w.call(U.se, 'GET', '/gst-recon?period=2026-10')).status, 403); assert.equal((await w.call(U.acc, 'GET', '/gst-recon/export?period=2026-10')).status, 200);
  void d;
});

test('ITC review: eligible, held, blocked, override with a reason, reversal beyond 180 days; the accounts manager prepares, the CFO approves; GSTR-1/3B; TDS; 26AS; calendar', async () => {
  const w = await world(); const d = w.d;
  d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'fin.itc.blocked_account_codes', '560004', 'string', 'company', 1, '2020-01-01', 't', 'test')").run();
  const b1 = w.bill(w.v1, 'INV/101', '2026-10-05', 100000, 18000); const b2 = w.bill(w.v2, 'B-200', '2026-10-09', 50000, 9000); const b3 = w.bill(w.v3, 'X-300', '2026-10-12', 10000, 1800);
  const b4 = w.bill(w.v1, 'CAT-9', '2026-10-14', 20000, 3600, { account: w.acct('560004') });
  const old = w.bill(w.v3, 'X-OLD', '2026-03-10', 100000, 18000, { paid: 4720000 }); // ₹47,200 of ₹1,18,000 paid
  const earlier = fill(d, 'gst_itc_reviews', { company_id: 1, doc_no: 'ITC/OLD', period: '2026-03', status: 'APPROVED', claimable_paise: 1800000, eligible_paise: 1800000 }); fill(d, 'gst_itc_review_lines', { company_id: 1, review_id: earlier, bill_id: old, decision: 'ELIGIBLE', tax_paise: 1800000, claim_paise: 1800000 });
  await w.call(U.acc, 'POST', '/gst-recon/import', { period: '2026-10', fileName: '2b.csv', format: 'CSV', content: csv([[V1, 'Deccan', 'Invoice', 'INV/101', '05-10-2026', '36', 'N', '18', '100000', '0', '9000', '9000', '0', 'Yes'], [V2, 'Pune Steel', 'Invoice', 'B-200', '09-10-2026', '36', 'N', '18', '50000', '8000', '0', '0', '0', 'Yes'], [V1, 'Deccan', 'Invoice', 'CAT-9', '14-10-2026', '36', 'N', '18', '20000', '0', '1800', '1800', '0', 'Yes']]) });
  assert.equal((await w.call(U.fin, 'POST', '/itc-reviews', { period: '2026-10' })).status, 403); assert.equal((await w.call(U.cfo, 'POST', '/itc-reviews', { period: '2026-10' })).status, 403);
  const c = await w.call(U.acc, 'POST', '/itc-reviews', { period: '2026-10' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let rv = c.json.data;
  const dec = (bill) => rv.lines.find((l) => l.billId === bill)?.decision;
  assert.equal(dec(b1), 'ELIGIBLE'); assert.equal(dec(b2), 'HELD_MISMATCH'); assert.equal(dec(b3), 'HELD_NOT_IN_2B'); assert.equal(dec(b4), 'BLOCKED_17_5'); assert.equal(dec(old), 'REVERSED_UNPAID_180');
  assert.equal(rv.eligible, 18000); assert.equal(rv.blocked, 3600); assert.equal(rv.held, 10800); assert.equal(rv.reversed, 10800, '₹70,800 unpaid of ₹1,18,000: 60 % of ₹18,000'); assert.equal(rv.claimable, 7200);
  assert.equal((await w.call(U.acc, 'POST', '/itc-reviews', { period: '2026-10' })).status, 409, 'one open review a month');
  // BR-01: a held invoice is claimed only with a reason; a blocked one never
  assert.equal((await w.call(U.acc, 'POST', `/itc-reviews/${rv.id}/override`, { billId: b3, claim: true, reason: 'short', version: rv.version })).status, 400);
  assert.equal((await w.call(U.acc, 'POST', `/itc-reviews/${rv.id}/override`, { billId: b4, claim: true, reason: 'Site canteen for the workers', version: rv.version })).status, 422);
  const ov = await w.call(U.acc, 'POST', `/itc-reviews/${rv.id}/override`, { billId: b3, claim: true, reason: 'Supplier filed GSTR-1 on 12-11; 2B of November will show it', version: rv.version }); assert.equal(ov.status, 200, JSON.stringify(ov.json)); rv = ov.json.data;
  assert.equal(rv.lines.find((l) => l.billId === b3).decision, 'OVERRIDE_CLAIM'); assert.equal(rv.override, 1800); assert.equal(rv.claimable, 9000);
  // approval: prepared by the accounts manager, approved by the CFO (the accounts manager's own step does not apply to their own review)
  assert.equal((await w.call(U.acc, 'POST', `/itc-reviews/${rv.id}/submit`)).status, 202);
  const inst = w.wf('gst_itc_reviews', rv.id); assert.equal((await w.tasksOf(U.acc)).filter((t) => t.instance.id === inst).length, 0, 'the maker never approves');
  assert.equal((await w.act(U.cfo, inst)).status, 200);
  rv = (await w.call(U.cfo, 'GET', `/itc-reviews/${rv.id}`)).json.data; assert.equal(rv.status, 'APPROVED'); assert.ok(rv.journalId, 'the reversal is posted');
  const jl = d.prepare('SELECT a.code, l.debit_paise, l.credit_paise FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY a.code').all(rv.journalId);
  assert.deepEqual(jl.map((x) => [x.code, x.debit_paise, x.credit_paise]), [['170001', 0, 540000], ['170002', 0, 540000], ['560011', 1080000, 0]]);
  assert.equal(w.events('fin.itc_review.approved').at(-1).claimable, 9000);
  assert.equal((await w.call(U.acc, 'GET', `/itc-reviews/${rv.id}/print`)).status, 200);
  // GSTR-1 from the sales, GSTR-3B with the approved ITC
  fill(d, 'bill_tax_invoices', { company_id: 1, org_project_id: w.A, bill_id: 1, invoice_no: '36/26-27/00011', invoice_date: '2026-10-20', sac_code: '9954', gst_pct_bp: 1800, taxable_paise: 50000000, cgst_paise: 4500000, sgst_paise: 4500000, igst_paise: 0, total_paise: 59000000, supply: 'intra', gstin_from: OWN, gstin_to: g('36AAAGT1234F1Z'), place_state: '36', status: 'APPROVED', irn_state: 'GENERATED', ar_state: 'HANDED' });
  const gr = (await w.call(U.acc, 'GET', '/gst-returns?period=2026-10')).json.data; assert.equal(gr.gstr1.b2b.length, 1); assert.equal(gr.gstr1.totals.cgst, 45000); assert.equal(gr.gstr3b.itc.net, 9000, 'ITC ₹19,800 (eligible and override) less ₹10,800 reversed');
  assert.equal(gr.gstr3b.outward.tax, 90000); assert.equal(gr.gstr3b.payable, 81000);
  assert.equal((await w.call(U.acc, 'POST', '/gst-returns/prepare', { period: '2026-10', returnType: 'GSTR3B' })).status, 200);
  assert.equal((await w.call(U.acc, 'POST', '/gst-returns/file', { period: '2026-10', returnType: 'GSTR3B', arn: 'AA3610260000001', filedOn: '2026-11-18' })).status, 200);
  assert.equal((await w.call(U.acc, 'POST', '/gst-returns/prepare', { period: '2026-10', returnType: 'GSTR3B' })).status, 409, 'a filed return is not prepared again');
  assert.equal((await w.call(U.acc, 'GET', '/gst-returns/export?period=2026-10&returnType=GSTR1')).status, 200);
  // TDS: Form 140 for October 2026 (Income-tax Act 2025), 26Q for January 2026; challans; filed; the certificate (Form 131)
  w.bill(w.v2, 'B-TDS', '2026-11-02', 200000, 36000, { tds: 4000 }); w.bill(w.v2, 'B-OLD', '2026-01-15', 100000, 18000, { tds: 2000 });
  let q = (await w.call(U.acc, 'GET', '/tds-returns?quarter=2026-27-Q3')).json.data; assert.equal(q.form, '140'); assert.equal(q.certificate, '131'); assert.equal(q.deducted, 4000); assert.equal(q.rows[0].pan, 'AABCE2222B');
  assert.equal((await w.call(U.aud, 'GET', '/tds-returns?quarter=2026-27-Q3')).json.data.rows[0].pan, 'AAB•••••2B', 'the PAN masked for the auditor');
  assert.equal((await w.call(U.acc, 'GET', '/tds-returns?quarter=2025-26-Q4')).json.data.form, '26Q');
  q = (await w.call(U.acc, 'POST', '/tds-returns/prepare', { quarter: '2026-27-Q3', challans: [{ bsr: '0510308', date: '2026-12-05', serial: '12345', amount: '3000', forMonth: '2026-11' }] })).json.data; assert.equal(q.status, 'DRAFT'); assert.equal(q.shortfall, 1000);
  assert.equal((await w.call(U.acc, 'POST', '/tds-returns/file', { quarter: '2026-27-Q3', tokenNo: '123456789012345', filedOn: '2027-01-20' })).status, 422, 'not filed with a shortfall');
  q = (await w.call(U.acc, 'POST', '/tds-returns/prepare', { quarter: '2026-27-Q3', challans: [{ bsr: '0510308', date: '2026-12-05', serial: '12345', amount: '4000', forMonth: '2026-11' }] })).json.data; assert.equal(q.status, 'PREPARED');
  assert.equal((await w.call(U.acc, 'POST', '/tds-returns/file', { quarter: '2026-27-Q3', tokenNo: '123456789012345', filedOn: '2027-01-20' })).json.data.status, 'FILED');
  const cert = await w.call(U.acc, 'GET', `/tds-returns/certificate?quarter=2026-27-Q3&partnerId=${w.v2}`); assert.equal(cert.status, 200);
  assert.equal((await w.call(U.cfo, 'GET', `/tds-returns/certificate?quarter=2026-27-Q3&partnerId=${w.v2}`)).status, 403);
  // 26AS: the TDS a client deducted from its payment, found in the books
  const client = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, pan, partner_status, steward_role, created_by) VALUES (1, 'C1', 'Telangana Housing Board', 'GOVERNMENT', 'AAAGT1234F', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  const rc = fill(d, 'ar_receipts', { company_id: 1, doc_no: 'RCPT/1', partner_id: client, receipt_date: '2026-10-10', amount_paise: 9800000, tds_paise: 200000, status: 'APPROVED' });
  const as26 = await w.call(U.acc, 'POST', '/tds-returns/26as', { fy: '2026-27', content: 'TAN of deductor,Name of deductor,Section,Transaction date,Amount paid/credited,TDS deposited\nHYDT01234E,Telangana Housing Board,393(1),12-10-2026,100000,2000\nHYDT01234E,Telangana Housing Board,393(1),12-11-2026,50000,1000' });
  assert.equal(as26.status, 201, JSON.stringify(as26.json)); assert.equal(as26.json.data.matched, 1); assert.equal(as26.json.data.lines.find((l) => l.status === 'MATCHED').receiptId, rc); assert.equal(as26.json.data.in26as, 3000); assert.equal(as26.json.data.inBooks, 2000);
  // the compliance calendar: GSTR-3B of October done, GSTR-1 of October not
  const cal = (await w.call(U.acc, 'GET', '/compliance-calendar?from=2026-10&to=2026-10')).json.data;
  assert.equal(cal.rows.find((r) => r.code === 'GSTR3B').status, 'DONE'); assert.equal(cal.rows.find((r) => r.code === 'GSTR2B_RECON').status, 'DONE'); assert.notEqual(cal.rows.find((r) => r.code === 'GSTR1').status, 'DONE');
  assert.equal((await w.call(U.se, 'GET', '/compliance-calendar')).status, 403);
});
