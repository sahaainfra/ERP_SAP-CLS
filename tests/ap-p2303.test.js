import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';

// Part 23.03: accounts payable.
//  T-01 the TDS threshold crossed mid-year: nothing on bills below the thresholds, then the whole year's amount taxed on the bill that crosses the annual threshold
//  (less nothing deducted), the next bill at the rate; the 2025 Act's section and certificate form from 01-04-2026; the rate without a PAN; an MSME vendor's bill
//  flagged with its Section 43B(h) date.
//  and: AP bills from a matched vendor invoice (TDS posted), an approved subcontractor bill, a passed expense claim; a direct expense bill approved by the head of the
//  department, the accounts manager and (above ₹1 lakh) the CFO, then posted; holds keep a bill out of the payable list (BR-02); a debit note approved, posted and set
//  against a bill; an advance set against a bill; the vendor ledger, ageing, MSME and TDS reports; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, fin: as('FINEX', 'fin1'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), aud: as('AUD', 'aud1'), se: as('SE', 'se9'), head: as('PM', 'head1') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id;
  d.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (1, 'Main Infra Pvt Ltd', ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(JSON.stringify([{ gstin: '36AAACM1234F1Z5', stateCode: '36' }]));
  let n = 0;
  const partner = (name, o = {}) => { n += 1; const id = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, msme_no, msme_category, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'PROCMGR', 'test')").run(`P${n}`, name, name, o.constitution ?? 'PRIVATE_LIMITED', o.pan === undefined ? 'AABCD1234E' : o.pan, o.msme ? `UDYAM-TS-00-000${n}` : null, o.msme ?? null).lastInsertRowid); fill(d, 'mdm_partner_gstins', { company_id: 1, partner_id: id, gstin: `36AABCD${String(1000 + n)}E1Z${n % 10}`, state_code: '36', gstin_status: 'ACTIVE' }); return id; };
  const inv = (vendorId, date, taxable, kind = 'SERVICE', due = null) => { n += 1; const id = 5000 + n; publishEvent(d, { type: 'ap.invoice.matched', entity: 'bill_vendor_invoices', entityId: id, actorId: 'test', companyId: 1, data: { invoiceId: id, invoiceNo: `INV-${n}`, invoiceDate: date, fy: '2026-27', kind, projectId: r.A, vendorId, vendorGstin: '36AABCD1234E1Z2', taxable, tax: Math.round(taxable * 18) / 100, total: taxable + Math.round(taxable * 18) / 100, debit: 0, payable: taxable + Math.round(taxable * 18) / 100, dueDate: due ?? date, matchStatus: 'MATCHED', itc: [] } }); return id; };
  const billOf = (source, ref) => d.prepare('SELECT * FROM ap_bills WHERE bill_source = ? AND source_ref = ?').get(source, String(ref));
  return { ...r, call, acct, partner, inv, billOf, drain: () => r.drain() };
}

test('T-01 BR-01 the TDS threshold crossed mid-year: the whole year taxed on the crossing bill, the next at the rate; the 2025 Act section; no PAN; MSME due date flagged', async () => {
  const w = await world();
  const v = w.partner('Kaveri Builders Pvt Ltd');
  const ids = [w.inv(v, '2026-05-10', 25000), w.inv(v, '2026-06-10', 25000), w.inv(v, '2026-07-10', 25000), w.inv(v, '2026-08-10', 30000), w.inv(v, '2026-09-10', 10000)];
  await w.drain();
  const bills = ids.map((i) => w.billOf('VENDOR_INVOICE', i));
  assert.deepEqual(bills.map((b) => b.tds_paise / 100), [0, 0, 0, 2100, 200], 'nothing below ₹1 lakh a year (and ₹30,000 a bill); on crossing, 2 % of ₹1,05,000; then 2 % of ₹10,000');
  assert.equal(bills[3].tds_basis, 'ANNUAL_CROSSED'); assert.equal(bills[0].tds_basis, 'BELOW_THRESHOLD');
  assert.equal(bills[3].tds_section, '393(1)'); assert.equal(bills[3].tds_act, 'IT2025'); assert.equal(bills[3].tds_certificate, '131'); assert.equal(bills[3].net_payable_paise, bills[3].total_paise - 210000);
  const j = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ? ORDER BY line_no').all(bills[3].journal_id);
  assert.equal(j.find((l) => l.account_id === w.acct('220001')).debit_paise, 210000); assert.equal(j.find((l) => l.account_id === w.acct('230004')).credit_paise, 210000);
  // the same bill in March 2026 is under the 1961 Act's 194C
  const pre = (await w.call(U.fin, 'GET', `/bills/tds-preview?partnerId=${v}&nature=CONTRACTOR&date=2026-03-15&amount=40000`)).json.data; assert.equal(pre.section, '194C'); assert.equal(pre.amount, 800);
  // no PAN: 20 %
  const np = w.partner('Unregistered Hirer', { pan: null, constitution: 'PROPRIETORSHIP' });
  const t2 = (await w.call(U.fin, 'GET', `/bills/tds-preview?partnerId=${np}&nature=CONTRACTOR&date=2026-06-01&amount=50000`)).json.data; assert.equal(t2.basis, 'NO_PAN'); assert.equal(t2.amount, 10000);
  // MSME (micro): agreed 60 days, at most 45 under Section 43B(h)
  const m = w.partner('Sri Sai Fabricators', { msme: 'MICRO' }); const mi = w.inv(m, '2026-06-01', 8000, 'SERVICE', '2026-07-31'); await w.drain();
  const mb = w.billOf('VENDOR_INVOICE', mi); assert.equal(mb.msme, 1); assert.equal(mb.msme_due_date, '2026-07-16'); assert.equal(mb.due_date, '2026-07-31');
  const rep = (await w.call(U.acc, 'GET', '/payables/msme?asOf=2026-07-20')).json.data; const row = rep.rows.find((x) => x.id === mb.id); assert.equal(row.state, 'OVERDUE'); assert.equal(row.daysLeft, -4);
  const tds = (await w.call(U.aud, 'GET', '/payables/tds?from=2026-04-01&to=2027-03-31')).json.data; assert.equal(tds.total, 2300); assert.equal(tds.rows.length, 2); assert.equal(tds.rows[0].quarter, 'Q2');
});

test('FR-01 §9 sources: vendor invoice, subcontractor bill, expense claim; a direct expense bill through the head of the department, the accounts manager and the CFO, then posted', async () => {
  const w = await world();
  const sub = w.partner('Godavari Earthmovers Pvt Ltd');
  publishEvent(w.d, { type: 'bill.sub.approved', entity: 'bill_sub_bills', entityId: 77, actorId: 'test', companyId: 1, data: { billId: 77, billNo: 'SB/77', seqNo: 1, billType: 'RA', projectId: w.A, woId: 1, subcontractorId: sub, periodFrom: '2026-06-01', periodTo: '2026-06-30', gross: 200000, cumGross: 200000, gst: 36000, rcm: 0, tds: 4000, retention: 10000, securityDeposit: 0, advanceRecovery: 0, deductions: 14000, net: 222000, dueDate: '2026-07-30', gstMode: 'NORMAL' } });
  const emp = fill(w.d, 'hr_employees', { company_id: 1, emp_code: 'E-1', first_name: 'Ravi', full_name: 'Ravi Kumar', employment_status: 'ACTIVE' });
  publishEvent(w.d, { type: 'exp.claim.passed', entity: 'exp_claims', entityId: 'EXP/1', actorId: 'test', companyId: 1, data: { docNo: 'EXP/1', employeeId: emp, netPayable: 3450, total: 3450 } });
  await w.drain();
  const sb = w.billOf('SUB_BILL', 77); assert.equal(sb.net_payable_paise, 22200000); assert.equal(sb.tds_paise, 400000); assert.equal(sb.tds_section, '393(1)'); assert.equal(sb.journal_id, null, 'its TDS was posted with the subcontractor bill (23.02)');
  const cl = w.billOf('EXPENSE_CLAIM', 'EXP/1'); assert.equal(cl.payee_name, 'Ravi Kumar'); assert.equal(cl.net_payable_paise, 345000);
  // the head of the department of the maker
  const dept = fill(w.d, 'org_departments', { company_id: 1, kind: 'DEPARTMENT', code: 'FIN', name: 'Finance' });
  const uid = (u) => w.d.prepare('SELECT id FROM iam_users WHERE username = ?').get(u).id;
  fill(w.d, 'iam_user_profiles', { user_id: uid('fin1'), company_id: 1, department_id: dept, is_active: 1 });
  fill(w.d, 'org_assignments', { company_id: 1, entity_type: 'DEPARTMENT', entity_id: dept, role: 'HEAD', user_id: uid('head1'), effective_from: '2026-01-01', applied: 1, is_active: 1 });
  w.d.prepare("UPDATE iam_users SET status = 'ACTIVE' WHERE username = 'head1'").run();
  const v = w.partner('Hyderabad Security Services Pvt Ltd');
  const body = { partnerId: v, projectId: w.A, billNo: 'HSS/118', billDate: '2026-07-05', description: 'Site security for June', expenseAccountId: w.acct('560004'), amount: 150000, gst: 27000, tdsNature: 'CONTRACTOR' };
  assert.equal((await w.call(U.aud, 'POST', '/bills', body)).status, 403);
  const c = await w.call(U.fin, 'POST', '/bills', body); assert.equal(c.status, 201, JSON.stringify(c.json));
  const id = c.json.data.id; assert.equal(c.json.data.tds, 3000, 'single bill above ₹30,000: 2 %'); assert.equal(c.json.data.netPayable, 174000);
  assert.equal((await w.call(U.fin, 'POST', `/bills/${id}/submit`)).status, 202);
  const wf = w.wf('ap_bills', id);
  assert.equal((await w.act(U.head, wf)).status, 200); assert.equal((await w.act(U.acc, wf)).status, 200);
  assert.equal((await w.call(U.fin, 'GET', `/bills/${id}`)).json.data.status, 'SUBMITTED', 'above ₹1 lakh the CFO approves too');
  assert.equal((await w.act(U.cfo, wf)).status, 200);
  const done = (await w.call(U.fin, 'GET', `/bills/${id}`)).json.data; assert.equal(done.status, 'APPROVED'); assert.ok(done.journalId);
  const lines = w.d.prepare('SELECT * FROM fin_journal_lines WHERE journal_id = ?').all(done.journalId); const at = (code) => lines.find((l) => l.account_id === w.acct(code));
  assert.equal(at('560004').debit_paise, 15000000); assert.equal(at('170001').debit_paise, 1350000); assert.equal(at('170002').debit_paise, 1350000); assert.equal(at('220001').credit_paise, 17400000); assert.equal(at('230004').credit_paise, 300000);
  assert.equal((await w.call(U.aud, 'GET', '/gl/integrity')).json.data.ok, true);
});

test('FR-05 BR-02 holds keep a bill out of payment; FR-03 a debit note approved, posted and set against the bill; FR-04 an advance set against a bill; FR-06 the vendor ledger and ageing; rights', async () => {
  const w = await world();
  const v = w.partner('Deccan Steel Ltd'); const i1 = w.inv(v, '2026-06-01', 40000); const i2 = w.inv(v, '2026-06-20', 20000); await w.drain();
  const b1 = w.billOf('VENDOR_INVOICE', i1); const b2 = w.billOf('VENDOR_INVOICE', i2);
  let pay = (await w.call(U.acc, 'GET', '/bills/payable?dueBy=2026-12-31')).json.data; assert.deepEqual(pay.map((x) => x.id).sort(), [b1.id, b2.id].sort());
  assert.equal((await w.call(U.se, 'POST', `/bills/${b1.id}/hold`, { hold: true, reason: 'Quality dispute on the bars' })).status, 403);
  const h = await w.call(U.fin, 'POST', `/bills/${b1.id}/hold`, { hold: true, reason: 'Quality dispute on the bars' }); assert.equal(h.status, 200); assert.equal(h.json.data.onHold, true);
  w.d.prepare("UPDATE mdm_partners SET payment_hold_until = '2099-01-01', payment_hold_reason = 'KYC to renew' WHERE id = ?").run(v);
  pay = (await w.call(U.acc, 'GET', '/bills/payable?dueBy=2026-12-31')).json.data; assert.equal(pay.length, 0, 'a held bill, and every bill of a held partner, is not offered for payment');
  w.d.prepare('UPDATE mdm_partners SET payment_hold_until = NULL WHERE id = ?').run(v);
  pay = (await w.call(U.acc, 'GET', '/bills/payable')).json.data; assert.deepEqual(pay.map((x) => x.id), [b2.id]);
  // a debit note for a rate difference on the first bill
  const dn = await w.call(U.fin, 'POST', '/debit-notes', { partnerId: v, projectId: w.A, billId: b1.id, reason: 'RATE_DIFFERENCE', noteDate: '2026-06-25', description: 'Rate above the purchase order', amount: 2000, gst: 360 }); assert.equal(dn.status, 201, JSON.stringify(dn.json));
  assert.equal((await w.call(U.fin, 'POST', `/debit-notes/${dn.json.data.id}/submit`)).status, 202);
  assert.equal((await w.act(U.acc, w.wf('ap_debit_notes', dn.json.data.id))).status, 200);
  const dnDone = (await w.call(U.fin, 'GET', `/debit-notes/${dn.json.data.id}`)).json.data; assert.equal(dnDone.status, 'APPROVED'); assert.ok(dnDone.journalId);
  const after1 = (await w.call(U.fin, 'GET', `/bills/${b1.id}`)).json.data; assert.equal(after1.adjusted, 2360); assert.equal(after1.outstanding, after1.netPayable - 2360);
  // an advance given to the vendor, set against the second bill
  const adv = fill(w.d, 'bill_advances', { company_id: 1, doc_no: 'ADV/1', org_project_id: w.A, direction: 'GIVEN', party_type: 'VENDOR', party_id: v, adv_type: 'MATERIAL', amount_paise: 1000000, advance_date: '2026-05-01', recovered_paise: 0, adv_state: 'ACTIVE', status: 'APPROVED', requested_by: 'test' });
  const bad = await w.call(U.acc, 'POST', `/bills/${b2.id}/adjust-advance`, { advanceId: adv, amount: 20000 }); assert.equal(bad.status, 400, 'more than the advance');
  const ok = await w.call(U.acc, 'POST', `/bills/${b2.id}/adjust-advance`, { advanceId: adv, amount: 5000 }); assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.data.adjusted, 5000);
  assert.equal(w.events('fin.advance.adjusted').length, 1);
  // the vendor ledger: bills credited, TDS, the debit note and the advance debited
  const led = (await w.call(U.aud, 'GET', `/payables/vendor-ledger?partnerId=${v}`)).json.data;
  const total = 40000 * 1.18 + 20000 * 1.18; const tds = 800; // the ₹20,000 bill is below both thresholds (₹30,000 a bill, ₹1 lakh a year)
  assert.equal(led.closing, Math.round((total - tds - 2360 - 5000) * 100) / 100);
  assert.equal(led.rows.filter((r) => r.kind === 'BILL').length, 2); assert.equal(led.rows.filter((r) => r.kind === 'DEBIT_NOTE').length, 1);
  const age = (await w.call(U.aud, 'GET', '/payables/ageing?asOf=2026-08-15')).json.data; const row = age.rows.find((x) => x.partnerId === v); assert.equal(row.b61, after1.outstanding, 'the June 1 bill is 75 days old'); assert.equal(row.b31, Math.round((20000 * 1.18 - 5000) * 100) / 100);
  const st = await w.api.call('GET', `${F}/payables/statement?partnerId=${v}`, { ...U.acc }); assert.equal(st.status, 200);
  const rec = (await w.call(U.acc, 'GET', '/reconciliation?asOf=2026-12-31')).json.data; const apRow = rec.rows.find((x) => x.code === 'AP'); assert.equal(apRow.difference, 0, JSON.stringify(apRow));
  assert.equal((await w.call(U.se, 'GET', '/bills')).status, 403); assert.equal((await w.call(U.aud, 'GET', '/bills')).status, 200);
  assert.equal((await w.call(U.aud, 'GET', '/gl/integrity')).json.data.ok, true);
});
