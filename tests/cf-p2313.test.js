import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { glOf } from '../src/server/modules/fin/index.js';
import { todayIST } from '../src/shared/dates.js';
import { weekOf, weekly } from '../src/server/modules/fin/cashforecast.js';

// Part 23.13: cash flow forecast and treasury.
//  T-01 the forecast lines equal the source schedules; the variance against the actual is worked out.
//  and: the weeks and scenarios; adjustments with their reason (BR-01); ACCMGR → CFO publication; the treasury (available, blocked, margin money, OD, BG limits,
//  facilities); payment priority (statutory, MSME, critical) also in the payment proposals; the project cash curve for the PM; rights and isolation.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), pm: as('PM', 'pm1'), dir: as('DIR', 'dir1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const today = todayIST(); const wk = weekOf(today);

test('T-01 the weeks add up; scenarios move collections later and payments earlier', () => {
  const L = [{ category: 'AR_OPEN', week_start: wk, inflow_paise: 100000, outflow_paise: 0 }, { category: 'AP_DUE', week_start: addDays(wk, 21), inflow_paise: 0, outflow_paise: 60000 }, { category: 'PAYROLL', week_start: addDays(wk, 7), inflow_paise: 0, outflow_paise: 30000 }];
  const b = weekly(L, { weekStart: wk, weeks: 4, opening: 10000 }); assert.deepEqual(b.rows.map((r) => r.closing), [110000, 80000, 80000, 20000]); assert.equal(b.lowest, 10000); assert.equal(b.closing, 20000);
  const d = weekly(L, { weekStart: wk, weeks: 4, opening: 10000, scenario: 'DELAYED_COLLECTIONS', shift: 2 }); assert.deepEqual(d.rows.map((r) => r.closing), [10000, -20000, 80000, 20000]); assert.equal(d.lowest, -20000); assert.equal(d.lowWeek, addDays(wk, 7));
  const a = weekly(L, { weekStart: wk, weeks: 4, opening: 10000, scenario: 'ACCELERATED_PAYMENTS', shift: 2 }); assert.deepEqual(a.rows.map((r) => r.outflow), [0, 90000, 0, 0]);
});

test('AC-01 the 13-week forecast from the source modules, published by the CFO; treasury; priorities; variance; project cash curve', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const acct = (code) => d.prepare('SELECT id FROM fin_accounts WHERE company_id = 1 AND code = ?').get(code)?.id; let n = 0;
  const post = (date, lines) => { n += 1; return glOf(d).postEngine(1, { date, narration: `t${n}`, sourceType: 'test', sourceId: n, lines: lines.map(([code, dr, cr, p, st]) => ({ accountId: acct(code), ...(dr ? { debit: String(dr) } : { credit: String(cr) }), ...(p ? { projectId: p } : {}), ...(st ? { siteId: st } : {}) })) }).journal.id; };
  const bank = fill(d, 'fin_bank_accounts', { company_id: 1, code: 'HDFC1', name: 'HDFC current', bank_name: 'HDFC Bank', ifsc: 'HDFC0000001', account_no_enc: 'x', account_last4: '4321', gl_account_id: acct('150002') });
  fill(d, 'fin_bank_account_profiles', { company_id: 1, bank_account_id: bank, account_kind: 'CASH_CREDIT', od_limit_paise: 50000000 });
  post(addDays(today, -60), [['150002', 1000000, 0], ['310001', 0, 1000000]]);
  // receivables: a client that paid 20 days late before; its open invoice is expected 20 days after its due date
  const client = fill(d, 'mdm_partners', { company_id: 1, code: 'CL1', legal_name: 'NHAI Region', partner_status: 'ACTIVE' });
  const old = fill(d, 'ar_invoices', { company_id: 1, doc_no: 'AR/1', inv_source: 'OTHER_INCOME', partner_id: client, invoice_date: addDays(today, -80), due_date: addDays(today, -50), amount_paise: 10000000, received_paise: 10000000, status: 'APPROVED' });
  const rc = fill(d, 'ar_receipts', { company_id: 1, doc_no: 'RC/1', partner_id: client, receipt_date: addDays(today, -30), amount_paise: 10000000, status: 'APPROVED' }); fill(d, 'ar_allocations', { company_id: 1, receipt_id: rc, invoice_id: old, amount_paise: 10000000 });
  fill(d, 'ar_invoices', { company_id: 1, doc_no: 'AR/2', inv_source: 'OTHER_INCOME', org_project_id: r.A, partner_id: client, invoice_no: 'INV/77', invoice_date: today, due_date: addDays(today, 10), amount_paise: 20000000, status: 'APPROVED' });
  // payables: an MSME bill, a critical supplier's bill, another
  const vM = fill(d, 'mdm_partners', { company_id: 1, code: 'V1', legal_name: 'Small Fab Works', partner_status: 'ACTIVE' }); const vC = fill(d, 'mdm_partners', { company_id: 1, code: 'V2', legal_name: 'Cement Co', partner_status: 'ACTIVE' }); const vO = fill(d, 'mdm_partners', { company_id: 1, code: 'V3', legal_name: 'Stationers', partner_status: 'ACTIVE' });
  const apb = (p, no, due, amt, msme = 0) => fill(d, 'ap_bills', { company_id: 1, doc_no: `AP/${no}`, bill_source: 'DIRECT', partner_id: p, payee_name: no, bill_no: no, bill_date: today, due_date: due, msme, msme_due_date: msme ? due : null, org_project_id: r.A, gross_paise: amt, total_paise: amt, net_payable_paise: amt, status: 'APPROVED' });
  apb(vO, 'OTH-1', addDays(today, 2), 3000000); apb(vC, 'CEM-1', addDays(today, 4), 4000000); apb(vM, 'MSME-1', addDays(today, 5), 10000000, 1);
  fill(d, 'bud_commitments', { company_id: 1, org_project_id: r.A, doc_ref: 'PO/9', amount: 40000000, status: 'OPEN', commit_date: today, src_type: 'PO', src_id: '9' });
  for (const k of [1, 2, 3]) post(`${addDays(today, -31 * k).slice(0, 7)}-15`, [['530002', 100000, 0, r.A, r.site], ['150002', 0, 100000]]);
  post(today, [['510001', 10000, 0, r.A], ['230004', 0, 10000]]);
  const ok = await call(U.acc, 'POST', '/treasury/facilities', { bankName: 'SBI', limitType: 'TERM_LOAN', limit: 5000000, utilised: 2000000, emi: 50000 }); assert.equal(ok.status, 400, 'an instalment needs its day');
  assert.equal((await call(U.acc, 'POST', '/treasury/facilities', { bankName: 'SBI', limitType: 'TERM_LOAN', limit: 5000000, utilised: 2000000, emi: 50000, emiDay: 10 })).status, 200);
  // the forecast
  assert.equal((await call(U.se, 'POST', '/cash-forecasts', {})).status, 403);
  const c = await call(U.acc, 'POST', '/cash-forecasts', {}); assert.equal(c.status, 201, JSON.stringify(c.json)); let f = c.json.data;
  assert.equal(f.weekStart, wk); assert.equal(f.weeks, 13); assert.equal(f.opening, 1000000 - 300000);
  const by = (cat) => f.lines.filter((l) => l.category === cat);
  assert.deepEqual(by('AR_OPEN').map((l) => [l.inflow, l.dueDate]), [[200000, addDays(today, 30)]], 'T-01: the due date plus the client\'s 20 days');
  assert.deepEqual(by('AP_DUE').map((l) => l.outflow).sort((a, b) => a - b), [30000, 40000, 100000]); assert.deepEqual(by('COMMITMENTS').map((l) => l.outflow), [200000, 200000]);
  assert.ok(by('PAYROLL').every((l) => l.outflow === 100000)); assert.equal(by('STATUTORY')[0].outflow, 10000); assert.ok(by('LOAN_EMI').every((l) => l.outflow === 50000));
  assert.equal(Math.round(f.weeksTable.reduce((a, x) => a + x.inflow - x.outflow, 0) * 100) / 100, Math.round((f.closing - f.opening) * 100) / 100, 'the weeks add up to the closing');
  // BR-01: an adjustment needs its reason
  assert.equal((await call(U.acc, 'POST', `/cash-forecasts/${f.id}/adjustments`, { category: 'OTHER_IN', date: addDays(today, 7), amount: 50000 })).status, 400);
  const adj = await call(U.acc, 'POST', `/cash-forecasts/${f.id}/adjustments`, { category: 'OTHER_IN', date: addDays(today, 7), amount: 50000, reason: 'Insurance claim settled by the insurer' }); assert.equal(adj.status, 201); assert.equal(adj.json.data.inflow, f.inflow + 50000); f = adj.json.data;
  const sc = (await call(U.acc, 'GET', `/cash-forecasts/${f.id}?scenario=DELAYED_COLLECTIONS&shift=4`)).json.data; assert.ok(sc.scenario.lowest <= f.lowest, 'collections later: never a better lowest point');
  assert.equal((await call(U.acc, 'POST', `/cash-forecasts/${f.id}/submit`)).status, 202); assert.equal((await r.act(U.cfo, r.wf('cf_forecasts', f.id))).status, 200);
  assert.equal((await call(U.cfo, 'GET', `/cash-forecasts/${f.id}`)).json.data.status, 'APPROVED'); assert.equal(r.events('fin.cash_forecast.published').at(-1).closing, f.closing);
  // the treasury: CC account with its limit, margin money on a guarantee given, the guarantee limit used
  fill(d, 'ctr_bank_guarantees', { company_id: 1, doc_no: 'BG/1', bg_no: 'BG-1', direction: 'GIVEN', bank_name: 'HDFC Bank', original_paise: 50000000, current_paise: 50000000, issue_date: today, expiry_date: addDays(today, 365), margin_bp: 1000, status: 'APPROVED', org_project_id: r.A });
  fill(d, 'ctr_bank_limits', { company_id: 1, bank_name: 'HDFC Bank', limit_kind: 'BG', limit_paise: 200000000, limit_status: 'ACTIVE' });
  const t = (await call(U.cfo, 'GET', '/treasury')).json.data; assert.equal(t.banks[0].kind, 'CASH_CREDIT'); assert.equal(t.banks[0].odLimit, 500000); assert.equal(t.totals.marginMoney, 50000); assert.equal(t.bgLimits[0].used, 500000); assert.equal(t.bgLimits[0].usedPct, 25);
  assert.equal(t.facilities[0].free, 3000000); assert.equal(t.forecast.id, f.id);
  // priorities: statutory, MSME, critical supplier, then the rest; the payment proposals rank the same way
  assert.equal((await call(U.acc, 'POST', '/treasury/critical-suppliers', { partnerId: vC, reason: 'Sole cement supplier for the project' })).status, 201);
  const pr = (await call(U.acc, 'GET', `/treasury/priorities?dueBy=${addDays(today, 10)}`)).json.data; assert.deepEqual(pr.rows.map((x) => x.class), ['STATUTORY', 'MSME', 'CRITICAL', 'OTHER']);
  const cand = (await call(U.acc, 'GET', `/proposals/candidates?dueBy=${addDays(today, 10)}`)); if (cand.status === 200) { const bills = cand.json.data.bills; assert.deepEqual(bills.map((b) => b.billNo), ['MSME-1', 'CEM-1', 'OTH-1']); assert.equal(bills[1].critical, true); }
  // actual against the forecast: a receipt this week
  post(today, [['150002', 150000, 0], ['140001', 0, 150000, r.A]]); post(today, [['150002', 5000, 0], ['150001', 0, 5000]]);
  const v = (await call(U.cfo, 'GET', `/cash-forecasts/variance?forecastId=${f.id}`)).json.data; assert.equal(v.rows[0].week, wk); assert.equal(v.rows[0].actualIn, 150000, 'the contra between bank and cash left out');
  assert.equal(v.rows[0].varianceIn, Math.round((150000 - v.rows[0].forecastIn) * 100) / 100);
  // the project cash curve: the PM sees his project's curve, not the treasury
  fill(d, 'ctr_contracts', { company_id: 1, org_project_id: r.A, contract_no: 'K-A', title: 'Main works', contract_type: 'ITEM_RATE', original_paise: 100000000, revised_paise: 100000000, completion_date: addDays(today, 400), status: 'APPROVED', contract_state: 'ACTIVE' });
  const cv = await call(U.pm, 'GET', `/cash-forecasts/project-curve?projectId=${r.A}`); assert.equal(cv.status, 200, JSON.stringify(cv.json)); assert.ok(cv.json.data.rows.some((x) => x.actual && x.actualIn === 150000)); assert.ok(cv.json.data.rows.some((x) => !x.actual && x.forecastIn > 0));
  assert.equal((await call(U.pm, 'GET', '/treasury')).status, 403); assert.equal((await call(U.dir, 'GET', '/treasury')).status, 200);
  assert.equal((await call(U.cfo, 'GET', `/cash-forecasts/${f.id}/print`)).status, 200); assert.equal((await call(as('CFO', 'cfo9', '2'), 'GET', `/cash-forecasts/${f.id}`)).status, 404);
});
